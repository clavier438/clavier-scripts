#!/usr/bin/env python3
"""
범용 Airtable 업로더 v5 (FML/LKP/RLP 계산 필드 지원)
====================================================
v4의 모든 기능 + formula, lookup, rollup 필드 지원.
4-pass 방식: 테이블+데이터 → LNK 생성 → 링크 데이터 → 계산 필드.

field type 코드 (OCI가 자동 생성 — 직접 작성 불필요):
  TXT  — singleLineText (기본값)
  LNG  — multilineText
  SEL  — singleSelect
  MSEL — multipleSelects
  ATT  — multipleAttachments
  LNK  — multipleRecordLinks ({ "type": "LNK", "target": "테이블명" })
  FML  — formula         ({ "type": "FML", "formula": "CONCATENATE({a}, {b})" })
  LKP  — lookup          ({ "type": "LKP", "link": "링크필드명", "target": "대상필드명" })
  RLP  — rollup          ({ "type": "RLP", "link": "링크필드명", "target": "대상필드명", "fn": "SUM" })

Usage:
  cd /path/to/job_folder
  python ~/Library/Mobile\\ Documents/com~apple~CloudDocs/0/scripts/airtableGenericV5.py
"""

import os, sys, json, time, csv, re, pathlib, argparse
import requests

SELF_DIR = pathlib.Path(__file__).resolve().parent
CLAVIER_ENV = pathlib.Path.home() / ".clavier" / "env"
META = "https://api.airtable.com/v0/meta"
API  = "https://api.airtable.com/v0"
COLORS = [
    "blueLight2","cyanLight2","tealLight2","greenLight2",
    "yellowLight2","orangeLight2","redLight2","pinkLight2",
    "purpleLight2","grayLight2"
]
HEADERS = {}

# ============================================================
# UTILS
# ============================================================
def load_pat():
    for key in ("AIRTABLE_API_KEY", "AIRTABLE_PAT"):
        pat = os.environ.get(key)
        if pat:
            print(f"  PAT: (env:{key}) {pat[:8]}...{pat[-4:]}"); return pat
    if CLAVIER_ENV.exists():
        for line in CLAVIER_ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k, v = line.split("=", 1)
            if k.strip() in ("AIRTABLE_API_KEY", "AIRTABLE_PAT"):
                t = v.strip()
                print(f"  PAT: (~/.clavier/env) {t[:8]}...{t[-4:]}"); return t
    print("ERROR: Airtable API 키 없음 — ~/.clavier/env 에 AIRTABLE_API_KEY=... 추가 필요"); sys.exit(1)

def call(method, url, data=None):
    for attempt in range(3):
        r = getattr(requests, method)(url, headers=HEADERS, json=data)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", 30))); continue
        if r.status_code >= 400:
            err = r.text[:300]
            print(f"  ERR {r.status_code}: {err}")
            if r.status_code == 422:
                try:
                    etype = r.json().get("error", {}).get("type", "")
                except Exception:
                    etype = ""
                if etype in ("DUPLICATE_OR_EMPTY_FIELD_NAME",
                             "UNSUPPORTED_FIELD_TYPE_FOR_CREATE",
                             "INVALID_FIELD_TYPE_OPTIONS_FOR_CREATE"):
                    return {}
                if data and data.get("options"):
                    ltd = data["options"].get("linkedTableId")
                    if ltd:
                        print("  → linkedTableId만 남기고 재시도...")
                        data["options"] = {"linkedTableId": ltd}
                        continue
            if attempt < 2: time.sleep(2); continue
            r.raise_for_status()
        time.sleep(0.22)
        return r.json()

def read_csv(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

def unique(rows, col):
    return list(dict.fromkeys(
        r.get(col,"").strip() for r in rows if r.get(col,"").strip()
    ))

def unique_msel(rows, col):
    seen = {}
    for r in rows:
        raw = r.get(col, "").strip()
        if not raw: continue
        try:
            vals = json.loads(raw)
            if isinstance(vals, list):
                for v in vals:
                    if v: seen[str(v)] = True
                continue
        except Exception:
            pass
        for v in raw.split(","):
            v = v.strip()
            if v: seen[v] = True
    return list(seen.keys())

def choices(vals):
    return [{"name":v,"color":COLORS[i%len(COLORS)]} for i,v in enumerate(vals)]

def normalize_raw_schema(cfg):
    """Raw Metadata API 포맷(tables[].fields = array) → 내부 포맷 변환.
    Raw 포맷: Airtable API가 준 그대로 — {id, name, type, options?} 배열.
    내부 포맷: {fieldName: spec} 딕셔너리 (기존 v4/v5 방식).
    choices, precision 등 정보가 완전히 보존됨.
    """
    if not cfg.get("tables"):
        return cfg
    if not isinstance(cfg["tables"][0].get("fields"), list):
        return cfg  # 이미 내부 포맷

    table_id_to_name = {t["id"]: t["name"] for t in cfg["tables"]}
    field_id_to_name = {}
    for t in cfg["tables"]:
        for f in t.get("fields", []):
            field_id_to_name[f["id"]] = f["name"]

    SKIP_EXPORT = {"aiText"}

    tables = []
    for t in cfg["tables"]:
        fields = {"_record_id": "TXT"}
        for f in t.get("fields", []):
            name = f["name"]
            ftype = f["type"]
            opts = f.get("options", {})

            if ftype in SKIP_EXPORT:
                continue
            if ftype == "singleLineText":
                fields[name] = "TXT"
            elif ftype in ("multilineText", "richText"):
                fields[name] = "LNG"
            elif ftype == "singleSelect":
                raw_choices = [{"name": c["name"], "color": c.get("color", COLORS[i % len(COLORS)])}
                               for i, c in enumerate(opts.get("choices", [])) if c.get("name")]
                fields[name] = {"type": "SEL", "choices": raw_choices}
            elif ftype == "multipleSelects":
                raw_choices = [{"name": c["name"], "color": c.get("color", COLORS[i % len(COLORS)])}
                               for i, c in enumerate(opts.get("choices", [])) if c.get("name")]
                fields[name] = {"type": "MSEL", "choices": raw_choices}
            elif ftype == "multipleAttachments":
                fields[name] = "ATT"
            elif ftype == "multipleRecordLinks":
                linked = table_id_to_name.get(opts.get("linkedTableId", ""))
                if linked:
                    fields[name] = {"type": "LNK", "target": linked}
            elif ftype == "formula":
                formula = opts.get("formula", "")
                if formula:
                    fields[name] = {"type": "FML", "formula": formula}
            elif ftype in ("lookup", "multipleLookupValues"):
                lnk = field_id_to_name.get(opts.get("recordLinkFieldId"))
                tgt = field_id_to_name.get(opts.get("fieldIdInLinkedTable"))
                if lnk and tgt:
                    fields[name] = {"type": "LKP", "link": lnk, "target": tgt}
            elif ftype == "rollup":
                lnk = field_id_to_name.get(opts.get("recordLinkFieldId"))
                tgt = field_id_to_name.get(opts.get("fieldIdInLinkedTable"))
                if lnk and tgt:
                    fields[name] = {"type": "RLP", "link": lnk, "target": tgt,
                                    "fn": opts.get("summarizeFunction", "SUM")}
            else:
                # number, currency, date, dateTime, checkbox, email, url 등
                if opts:
                    fields[name] = {"type": ftype, "options": opts}
                else:
                    fields[name] = {"type": ftype}

        tables.append({
            "name": t["name"],
            "csv": t["name"] + ".csv",
            "primary_key": "_record_id",
            "fields": fields,
        })

    return {
        "version": "raw-v1",
        "base": cfg.get("base", ""),
        "workspaceId": cfg.get("workspaceId", ""),
        "tables": tables,
    }


def parse_att(val):
    """CSV 첨부파일 값 → Airtable API 형식 [{"url": "..."}]"""
    if not val or not val.strip():
        return None
    try:
        parsed = json.loads(val)
        if isinstance(parsed, list):
            urls = [{"url": a["url"]} for a in parsed if isinstance(a, dict) and "url" in a]
            return urls if urls else None
    except Exception:
        pass
    val = val.strip()
    if val.startswith(("http://", "https://")):
        return [{"url": val}]
    return None

def parse_msel(val):
    """CSV 다중선택 값 → Airtable API 형식 ["opt1", "opt2"]"""
    if not val or not val.strip():
        return None
    try:
        parsed = json.loads(val)
        if isinstance(parsed, list):
            return [str(v) for v in parsed if v] or None
    except Exception:
        pass
    vals = [v.strip() for v in val.split(",") if v.strip()]
    return vals if vals else None

def get_all_field_ids(base_id):
    """Metadata API에서 모든 테이블의 필드 ID 가져오기 — {table_id: {field_name: field_id}}"""
    res = call("get", f"{META}/bases/{base_id}/tables")
    result = {}
    for t in res.get("tables", []):
        result[t["id"]] = {f["name"]: f["id"] for f in t.get("fields", [])}
    return result

# ============================================================
# SCHEMA PARSER
# ============================================================
def parse_fields(tbl_cfg):
    """Returns: selects, mselects, longs, atts, links, computed
    selects/mselects: {col: choices_list} — choices가 있으면 보존, 없으면 []
    """
    selects  = {}  # col → choices list
    mselects = {}
    longs    = set()
    atts     = set()
    links    = {}
    computed = {}

    for col, spec in tbl_cfg.get("fields", {}).items():
        if isinstance(spec, dict):
            ftype = spec.get("type")
            if ftype == "LNK":
                links[col] = spec["target"]
            elif ftype in ("FML", "LKP", "RLP"):
                computed[col] = spec
            elif ftype == "SEL":
                selects[col] = spec.get("choices", [])
            elif ftype == "MSEL":
                mselects[col] = spec.get("choices", [])
            elif ftype == "LNG":
                longs.add(col)
            elif ftype == "ATT":
                atts.add(col)
            # number, date 등 기타 타입은 build_table_fields에서 처리
        elif spec == "SEL":  selects[col] = []
        elif spec == "MSEL": mselects[col] = []
        elif spec == "LNG":  longs.add(col)
        elif spec == "ATT":  atts.add(col)

    return selects, mselects, longs, atts, links, computed

def validate_schema(cfg):
    errors = []
    if "tables" not in cfg or not cfg["tables"]:
        errors.append("tables 배열 없음")
    else:
        table_names = {t["name"] for t in cfg["tables"]}
        for tbl in cfg["tables"]:
            if "name" not in tbl:        errors.append("tables[].name 없음")
            if "csv" not in tbl:         errors.append(f"{tbl.get('name','?')}: csv 없음")
            if "primary_key" not in tbl: errors.append(f"{tbl.get('name','?')}: primary_key 없음")
            for col, spec in tbl.get("fields", {}).items():
                if not isinstance(spec, dict): continue
                ftype = spec.get("type")
                if ftype == "LNK":
                    if "target" not in spec:
                        errors.append(f"{tbl['name']}.{col}: LNK target 없음")
                    elif spec["target"] not in table_names:
                        errors.append(f"{tbl['name']}.{col}: LNK target '{spec['target']}' 이 tables에 없음")
                elif ftype == "FML":
                    if "formula" not in spec:
                        errors.append(f"{tbl['name']}.{col}: FML formula 없음")
                elif ftype in ("LKP", "RLP"):
                    if "link" not in spec:
                        errors.append(f"{tbl['name']}.{col}: {ftype} link 없음")
                    if "target" not in spec:
                        errors.append(f"{tbl['name']}.{col}: {ftype} target 없음")
                    if ftype == "RLP" and "fn" not in spec:
                        errors.append(f"{tbl['name']}.{col}: RLP fn 없음 (예: SUM, COUNT, MAX, MIN, AVG)")
    if errors:
        print("ERROR: schema.json 유효성 오류")
        for e in errors: print(f"  - {e}")
        sys.exit(1)

# ============================================================
# CORE
# ============================================================
def _field_options_for_create(ftype, opts):
    """Airtable 필드 생성 API용 clean options — ID 등 불필요한 키 제거."""
    if ftype in ("number", "currency", "percent", "rating", "duration"):
        clean = {}
        if "precision" in opts: clean["precision"] = opts["precision"]
        if "symbol" in opts: clean["symbol"] = opts["symbol"]
        return clean or None
    if ftype == "date":
        return {"dateFormat": opts["dateFormat"]} if "dateFormat" in opts else None
    if ftype == "dateTime":
        clean = {}
        for k in ("dateFormat", "timeFormat", "timeZone"):
            if k in opts: clean[k] = opts[k]
        return clean or None
    if ftype == "checkbox":
        return {
            "icon": opts.get("icon", "check"),
            "color": opts.get("color", "greenBright")
        }
    return None


def build_table_fields(tbl_cfg, rows):
    selects, mselects, longs, atts, links, computed = parse_fields(tbl_cfg)
    skip_cols = set(links.keys()) | set(computed.keys())
    fields_spec = tbl_cfg.get("fields", {})
    fields = []
    col_source = rows[0].keys() if rows else fields_spec.keys()
    for col in col_source:
        if col in skip_cols:
            continue
        if col in selects:
            schema_choices = selects[col]
            field_choices = schema_choices if schema_choices else choices(unique(rows, col))
            fields.append({"name": col, "type": "singleSelect",
                           "options": {"choices": field_choices}})
        elif col in mselects:
            schema_choices = mselects[col]
            field_choices = schema_choices if schema_choices else choices(unique_msel(rows, col))
            fields.append({"name": col, "type": "multipleSelects",
                           "options": {"choices": field_choices}})
        elif col in longs:
            fields.append({"name": col, "type": "multilineText"})
        elif col in atts:
            fields.append({"name": col, "type": "multipleAttachments"})
        else:
            spec = fields_spec.get(col)
            if isinstance(spec, dict) and spec.get("type") not in (
                    "LNK", "FML", "LKP", "RLP", "SEL", "MSEL", "LNG", "ATT"):
                ftype = spec["type"]
                opts = spec.get("options", {})
                field_def = {"name": col, "type": ftype}
                clean_opts = _field_options_for_create(ftype, opts)
                if clean_opts:
                    field_def["options"] = clean_opts
                fields.append(field_def)
            else:
                fields.append({"name": col, "type": "singleLineText"})
    return fields

def create_base(cfg, first_tbl_cfg, first_rows):
    ws_id = cfg.get("workspaceId")
    if not ws_id:
        bases = call("get", f"{META}/bases").get("bases", [])
        if bases:
            detail = call("get", f"{META}/bases/{bases[0]['id']}")
            ws_id = detail.get("workspaceId")
    fields = build_table_fields(first_tbl_cfg, first_rows)
    body = {
        "name": cfg["base"],
        "tables": [{"name": first_tbl_cfg["name"], "fields": fields}]
    }
    if ws_id:
        body["workspaceId"] = ws_id
    res = call("post", f"{META}/bases", body)
    bid = res.get("id")
    if not bid:
        print(f"ERROR: base 생성 실패: {res}"); sys.exit(1)
    first_tid = next((t["id"] for t in res.get("tables", []) if t.get("name") == first_tbl_cfg["name"]), None)
    print(f"  Base 생성: {cfg['base']} → {bid}" + (f" (ws: {ws_id})" if ws_id else ""))
    if first_tid:
        print(f"  Created (inline): {first_tbl_cfg['name']} → {first_tid}")
    return bid, first_tid

def create_table(base_id, tbl_cfg, rows):
    fields = build_table_fields(tbl_cfg, rows)
    res = call("post", f"{META}/bases/{base_id}/tables",
               {"name": tbl_cfg["name"], "fields": fields})
    tid = res["id"]
    print(f"  Created: {tbl_cfg['name']} → {tid}")
    return tid

def upload_records(base_id, table_id, rows, exclude, atts, mselects, name, field_types=None):
    field_types = field_types or {}
    ids = []
    clean = []
    for r in rows:
        fdata = {}
        for k, v in r.items():
            if k in exclude:
                continue
            if k in atts:
                att_val = parse_att(v)
                if att_val:
                    fdata[k] = att_val
            elif k in mselects:
                msel_val = parse_msel(v)
                if msel_val:
                    fdata[k] = msel_val
            else:
                if k not in field_types:
                    continue  # 스키마에 없는 컬럼 무시
                ftype = field_types[k]
                coerced = coerce(v, ftype)
                if coerced is not None:
                    fdata[k] = coerced
        clean.append(fdata)
    for i in range(0, len(clean), 10):
        res = call("post", f"{API}/{base_id}/{table_id}",
                   {"records":[{"fields":r} for r in clean[i:i+10]]})
        if res:
            ids.extend(r["id"] for r in res.get("records",[]))
        print(f"    {name}: {len(ids)}/{len(clean)}")
        time.sleep(0.3)
    return ids

def get_field_types(tbl_cfg):
    """schema 필드 spec → {field_name: airtable_type} 매핑."""
    types = {}
    for col, spec in tbl_cfg.get("fields", {}).items():
        if isinstance(spec, dict):
            ftype = spec.get("type", "singleLineText")
            if ftype in ("SEL", "LNK", "FML", "LKP", "RLP"): ftype = "singleLineText"
            elif ftype == "MSEL": ftype = "multipleSelects"
            elif ftype == "LNG": ftype = "multilineText"
            elif ftype == "ATT": ftype = "multipleAttachments"
            types[col] = ftype
        elif spec == "SEL":  types[col] = "singleSelect"
        elif spec == "MSEL": types[col] = "multipleSelects"
        elif spec == "LNG":  types[col] = "multilineText"
        elif spec == "ATT":  types[col] = "multipleAttachments"
        else:                types[col] = "singleLineText"
    return types


def coerce(val, ftype):
    """CSV 문자열 → Airtable API 타입으로 변환."""
    if not val or not val.strip():
        return None
    v = val.strip()
    if ftype in ("number", "currency", "percent", "rating", "duration"):
        try:
            n = float(v.replace(",", ""))
            return int(n) if n == int(n) else n
        except (ValueError, OverflowError):
            return None
    if ftype == "checkbox":
        return v.lower() in ("true", "1", "yes", "✓")
    return v


def resolve(csv_val, id_map):
    if not csv_val or csv_val.strip() in ("","없음","-"): return []
    ids = []
    for part in [p.strip() for p in csv_val.split(",")]:
        if part in id_map:
            ids.append(id_map[part]); continue
        clean = re.sub(r'\s*\(.*?\)','',part).strip()
        if clean in id_map:
            ids.append(id_map[clean]); continue
        for name, rid in id_map.items():
            if part in name or name in part:
                ids.append(rid); break
    return ids

# ============================================================
# MAIN
# ============================================================
def main():
    parser = argparse.ArgumentParser(
        prog="airtableGenericV5.py",
        description="schema.json + CSV 폴더로 Airtable base를 생성하는 범용 업로더 (v5: FML/LKP/RLP 지원)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  # 폴더명이 base 이름이 됨
  cd ~/Downloads/sisoso_1.0.1 && python airtableGenericV5.py

  # base 이름 명시적으로 덮어쓰기
  cd ~/Downloads/sisoso_1.0.1 && python airtableGenericV5.py --base "새프로젝트"

  # 워크스페이스 지정
  cd ~/Downloads/sisoso_1.0.1 && python airtableGenericV5.py --workspace wspXXX

  # airtableUploadV5.sh 래퍼 사용 시
  airtableUploadV5 ~/Downloads/sisoso_1.0.1
  airtableUploadV5 ~/Downloads/sisoso_1.0.1 --base "새프로젝트" --workspace wspXXX

v5 schema.json FML/LKP/RLP 예시:
  "fields": {
    "full_name":   {"type": "FML", "formula": "CONCATENATE({first}, ' ', {last})"},
    "city_name":   {"type": "LKP", "link": "location", "target": "city"},
    "total_price": {"type": "RLP", "link": "orders", "target": "price", "fn": "SUM"}
  }
  (link/target은 이미 정의된 LNK 필드명 / 대상 테이블의 필드명)
        """,
    )
    parser.add_argument("--base", metavar="NAME", help="base 이름 (기본값: 현재 폴더명)")
    parser.add_argument("--workspace", metavar="WS_ID", help="워크스페이스 ID")
    args = parser.parse_args()

    print("="*60)
    print("Airtable 범용 업로더 v5 (FML/LKP/RLP 지원)")
    print("="*60)

    schema_path = pathlib.Path("schema.json")
    if not schema_path.exists():
        candidates = sorted(pathlib.Path(".").glob("[Ss][Cc][Hh][Ee][Mm][Aa]*.json"))
        if not candidates:
            print("ERROR: schema.json 없음"); sys.exit(1)
        schema_path = candidates[0]
        print(f"  schema 파일: {schema_path.name}")

    cfg = json.loads(schema_path.read_text(encoding="utf-8"))
    cfg = normalize_raw_schema(cfg)  # raw Metadata API 포맷이면 내부 포맷으로 변환

    cfg["base"] = args.base if args.base else pathlib.Path.cwd().name
    if args.workspace:
        cfg["workspaceId"] = args.workspace
    else:
        cfg.pop("workspaceId", None)

    validate_schema(cfg)
    ws_label = f" / ws: {cfg['workspaceId']}" if cfg.get("workspaceId") else ""
    print(f"  Job: {cfg.get('job','(unnamed)')} / Base: {cfg['base']} / Tables: {len(cfg['tables'])}{ws_label}")

    # Computed field summary
    total_computed = sum(
        len([s for s in tbl.get("fields", {}).values()
             if isinstance(s, dict) and s.get("type") in ("FML","LKP","RLP")])
        for tbl in cfg["tables"]
    )
    if total_computed:
        print(f"  계산 필드: {total_computed}개 (Phase 4에서 생성)")

    pat = load_pat()
    HEADERS["Authorization"] = f"Bearer {pat}"
    HEADERS["Content-Type"] = "application/json"

    first_tbl = cfg["tables"][0]
    first_rows = read_csv(first_tbl["csv"])
    base_id, first_tid = create_base(cfg, first_tbl, first_rows)

    # --- Phase 1: 테이블 생성 + 데이터 업로드 ---
    print(f"\n{'='*60}")
    print("Phase 1: 테이블 생성 + 데이터 업로드")
    print(f"{'='*60}")
    table_data = {}

    for i, tbl in enumerate(cfg["tables"]):
        print(f"\n--- {tbl['name']} ---")
        rows = first_rows if i == 0 else read_csv(tbl["csv"])
        col_count = len(rows[0]) if rows else 0
        print(f"  CSV: {len(rows)} rows × {col_count} cols")

        selects, mselects, longs, atts, links, computed = parse_fields(tbl)
        skip_cols = set(links.keys()) | set(computed.keys())
        field_types = get_field_types(tbl)
        tid = first_tid if (i == 0 and first_tid) else create_table(base_id, tbl, rows)
        rec_ids = upload_records(base_id, tid, rows, skip_cols, atts, mselects, tbl["name"], field_types)

        pk = tbl["primary_key"]
        pk_map = {}
        for j, row in enumerate(rows):
            if j < len(rec_ids):
                pk_map[row[pk].strip()] = rec_ids[j]

        table_data[tbl["name"]] = {
            "id": tid, "rows": rows, "rec_ids": rec_ids,
            "cfg": tbl, "pk_map": pk_map
        }

    # --- Phase 2: Linked Record 필드 생성 ---
    print(f"\n{'='*60}")
    print("Phase 2: Linked Record 필드 생성")
    print(f"{'='*60}")
    created_links = {}

    for tbl in cfg["tables"]:
        _, _, _, _, links, _ = parse_fields(tbl)
        if not links: continue
        src = table_data[tbl["name"]]

        for link_col, target_name in links.items():
            tgt = table_data[target_name]

            reverse_key = (target_name, tbl["name"])
            if reverse_key in created_links:
                print(f"  {tbl['name']}.{link_col} — 역방향 이미 생성됨, 스킵")
                continue

            print(f"  생성: {tbl['name']}.{link_col} → {target_name}")
            res = call("post", f"{META}/bases/{base_id}/tables/{src['id']}/fields", {
                "name": link_col,
                "type": "multipleRecordLinks",
                "options": {"linkedTableId": tgt["id"]}
            })

            fid = res.get("id")
            inv_fid = res.get("options",{}).get("inverseLinkFieldId")
            if fid:
                created_links[(tbl["name"], target_name)] = fid

            if inv_fid:
                inv_name = None
                for t2 in cfg["tables"]:
                    if t2["name"] == target_name:
                        _, _, _, _, t2_links, _ = parse_fields(t2)
                        for lc, lc_target in t2_links.items():
                            if lc_target == tbl["name"]:
                                inv_name = lc; break
                if inv_name:
                    print(f"  역방향 필드 rename → '{inv_name}'")
                    call("patch",
                         f"{META}/bases/{base_id}/tables/{tgt['id']}/fields/{inv_fid}",
                         {"name": inv_name})
                    created_links[(target_name, tbl["name"])] = inv_fid

    # --- Phase 3: 링크 데이터 연결 ---
    print(f"\n{'='*60}")
    print("Phase 3: 링크 데이터 연결")
    print(f"{'='*60}")

    for tbl in cfg["tables"]:
        _, _, _, _, links, _ = parse_fields(tbl)
        if not links: continue
        src = table_data[tbl["name"]]

        for link_col, target_name in links.items():
            tgt = table_data[target_name]

            updates = []
            for i, row in enumerate(src["rows"]):
                if i >= len(src["rec_ids"]): break
                resolved = resolve(row.get(link_col,""), tgt["pk_map"])
                if resolved:
                    updates.append({
                        "id": src["rec_ids"][i],
                        "fields": {link_col: resolved}
                    })

            print(f"  {tbl['name']}.{link_col}: {len(updates)}건 연결")
            for i in range(0, len(updates), 10):
                call("patch", f"{API}/{base_id}/{src['id']}",
                     {"records": updates[i:i+10]})
                print(f"    {min(i+10,len(updates))}/{len(updates)}")
                time.sleep(0.3)

    # --- Phase 4: 계산 필드 생성 (FML / LKP / RLP) ---
    print(f"\n{'='*60}")
    print("Phase 4: 계산 필드 생성 (FML/LKP/RLP)")
    print(f"{'='*60}")

    has_computed = any(
        parse_fields(tbl)[5]  # computed dict
        for tbl in cfg["tables"]
    )

    if has_computed:
        # Metadata API로 현재 필드 ID 전체 조회 (Phase 2에서 LNK 필드가 생겼으므로 여기서 조회)
        print("  필드 ID 조회 중...")
        all_field_ids = get_all_field_ids(base_id)

        for tbl in cfg["tables"]:
            _, _, _, _, links, computed = parse_fields(tbl)
            if not computed: continue

            src = table_data[tbl["name"]]
            src_field_ids = all_field_ids.get(src["id"], {})

            for col, spec in computed.items():
                ftype = spec["type"]
                print(f"\n  {tbl['name']}.{col} ({ftype})")

                if ftype == "FML":
                    res = call("post", f"{META}/bases/{base_id}/tables/{src['id']}/fields", {
                        "name": col,
                        "type": "formula",
                        "options": {"formula": spec["formula"]}
                    })
                    fid = res.get("id")
                    print(f"    formula: {spec['formula']}")
                    print(f"    → {fid or 'ERR'}")

                elif ftype in ("LKP", "RLP"):
                    link_col = spec["link"]
                    link_fid = src_field_ids.get(link_col)
                    if not link_fid:
                        print(f"    WARN: link field '{link_col}'의 ID를 못 찾음 — 스킵")
                        continue

                    target_tbl_name = links.get(link_col)
                    if not target_tbl_name:
                        print(f"    WARN: '{link_col}'이 LNK 필드가 아님 — 스킵")
                        continue

                    tgt = table_data[target_tbl_name]
                    tgt_field_ids = all_field_ids.get(tgt["id"], {})
                    target_fid = tgt_field_ids.get(spec["target"])
                    if not target_fid:
                        print(f"    WARN: '{spec['target']}' 필드를 {target_tbl_name}에서 못 찾음 — 스킵")
                        continue

                    if ftype == "LKP":
                        res = call("post", f"{META}/bases/{base_id}/tables/{src['id']}/fields", {
                            "name": col,
                            "type": "lookup",
                            "options": {
                                "recordLinkFieldId": link_fid,
                                "fieldIdInLinkedTable": target_fid
                            }
                        })
                    else:  # RLP
                        res = call("post", f"{META}/bases/{base_id}/tables/{src['id']}/fields", {
                            "name": col,
                            "type": "rollup",
                            "options": {
                                "recordLinkFieldId": link_fid,
                                "fieldIdInLinkedTable": target_fid,
                                "summarizeFunction": spec.get("fn", "SUM")
                            }
                        })

                    fid = res.get("id")
                    print(f"    link: {link_col} ({link_fid}) → {target_tbl_name}.{spec['target']} ({target_fid})")
                    print(f"    → {fid or 'ERR'}")
    else:
        print("  (계산 필드 없음 — 스킵)")

    # --- Done ---
    print("\n" + "="*60)
    print("COMPLETE!")
    print("="*60)
    for name, d in table_data.items():
        print(f"  {name}: {len(d['rec_ids'])} records ({d['id']})")
    print(f"\n  Base URL: https://airtable.com/{base_id}")

if __name__ == "__main__":
    main()
