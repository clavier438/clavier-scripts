#!/usr/bin/env python3
"""
범용 Airtable 업로더 v4 (schema.json 프로토콜 지원)
====================================================
OCI가 자동 생성한 schema.json + CSV 파일들로 어떤 데이터든 에어테이블에 넣음.
테이블 생성, 필드타입, Linked Record까지 전부 자동.

field type 코드 (OCI가 자동 생성 — 직접 작성 불필요):
  TXT  — singleLineText (기본값)
  LNG  — multilineText
  SEL  — singleSelect
  MSEL — multipleSelects
  ATT  — multipleAttachments
  LNK  — multipleRecordLinks ({ "type": "LNK", "target": "테이블명" })

Usage:
  cd /path/to/job_folder
  python ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/scripts/airtableGeneric.py
"""

import os, sys, json, time, csv, re, pathlib
import requests

SELF_DIR = pathlib.Path(__file__).resolve().parent
ENV_PATH = SELF_DIR / "env.md"
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
    pat = os.environ.get("AIRTABLE_PAT")
    if pat:
        print(f"  PAT: (env) {pat[:8]}...{pat[-4:]}"); return pat
    if ENV_PATH.exists():
        m = re.search(r'(pat[A-Za-z0-9_\-\.]{30,})', ENV_PATH.read_text(encoding="utf-8"))
        if m:
            t = m.group(1); print(f"  PAT: (env.md) {t[:8]}...{t[-4:]}"); return t
    print("ERROR: PAT 없음 — AIRTABLE_PAT 환경변수 또는 env.md 필요"); sys.exit(1)

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
                if etype == "DUPLICATE_OR_EMPTY_FIELD_NAME":
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

# ============================================================
# SCHEMA PARSER
# ============================================================
def parse_fields(tbl_cfg):
    selects  = set()
    mselects = set()
    longs    = set()
    atts     = set()
    links    = {}

    for col, spec in tbl_cfg.get("fields", {}).items():
        if isinstance(spec, dict):
            if spec.get("type") == "LNK":
                links[col] = spec["target"]
        elif spec == "SEL":  selects.add(col)
        elif spec == "MSEL": mselects.add(col)
        elif spec == "LNG":  longs.add(col)
        elif spec == "ATT":  atts.add(col)

    return selects, mselects, longs, atts, links

def validate_schema(cfg):
    errors = []
    if "base" not in cfg:
        errors.append("base 필드 없음")
    if "tables" not in cfg or not cfg["tables"]:
        errors.append("tables 배열 없음")
    else:
        table_names = {t["name"] for t in cfg["tables"]}
        for tbl in cfg["tables"]:
            if "name" not in tbl:        errors.append("tables[].name 없음")
            if "csv" not in tbl:         errors.append(f"{tbl.get('name','?')}: csv 없음")
            if "primary_key" not in tbl: errors.append(f"{tbl.get('name','?')}: primary_key 없음")
            for col, spec in tbl.get("fields", {}).items():
                if isinstance(spec, dict) and spec.get("type") == "LNK":
                    if "target" not in spec:
                        errors.append(f"{tbl['name']}.{col}: LNK target 없음")
                    elif spec["target"] not in table_names:
                        errors.append(f"{tbl['name']}.{col}: LNK target '{spec['target']}' 이 tables에 없음")
    if errors:
        print("ERROR: schema.json 유효성 오류")
        for e in errors: print(f"  - {e}")
        sys.exit(1)

# ============================================================
# CORE
# ============================================================
def build_table_fields(tbl_cfg, rows):
    selects, mselects, longs, atts, links = parse_fields(tbl_cfg)
    link_cols = set(links.keys())
    fields = []
    for col in rows[0].keys():
        if col in link_cols:
            continue
        if col in selects:
            fields.append({"name":col, "type":"singleSelect",
                          "options":{"choices":choices(unique(rows,col))}})
        elif col in mselects:
            fields.append({"name":col, "type":"multipleSelects",
                          "options":{"choices":choices(unique_msel(rows,col))}})
        elif col in longs:
            fields.append({"name":col, "type":"multilineText"})
        elif col in atts:
            fields.append({"name":col, "type":"multipleAttachments"})
        else:
            fields.append({"name":col, "type":"singleLineText"})
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

def upload_records(base_id, table_id, rows, exclude, atts, mselects, name):
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
            elif v.strip():
                fdata[k] = v
        clean.append(fdata)
    for i in range(0, len(clean), 10):
        res = call("post", f"{API}/{base_id}/{table_id}",
                   {"records":[{"fields":r} for r in clean[i:i+10]]})
        if res:
            ids.extend(r["id"] for r in res.get("records",[]))
        print(f"    {name}: {len(ids)}/{len(clean)}")
        time.sleep(0.3)
    return ids

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
    print("="*60)
    print("Airtable 범용 업로더 v4")
    print("="*60)

    schema_path = pathlib.Path("schema.json")
    if not schema_path.exists():
        candidates = sorted(pathlib.Path(".").glob("[Ss][Cc][Hh][Ee][Mm][Aa]*.json"))
        if not candidates:
            print("ERROR: schema.json 없음"); sys.exit(1)
        schema_path = candidates[0]
        print(f"  schema 파일: {schema_path.name}")

    cfg = json.loads(schema_path.read_text(encoding="utf-8"))
    validate_schema(cfg)
    ws_label = f" / ws: {cfg['workspaceId']}" if cfg.get("workspaceId") else ""
    print(f"  Job: {cfg.get('job','(unnamed)')} / Base: {cfg['base']} / Tables: {len(cfg['tables'])}{ws_label}")

    pat = load_pat()
    HEADERS["Authorization"] = f"Bearer {pat}"
    HEADERS["Content-Type"] = "application/json"

    first_tbl = cfg["tables"][0]
    first_rows = read_csv(first_tbl["csv"])
    base_id, first_tid = create_base(cfg, first_tbl, first_rows)

    # --- Phase 1: 테이블 생성 + 데이터 업로드 ---
    table_data = {}

    for i, tbl in enumerate(cfg["tables"]):
        print(f"\n--- {tbl['name']} ---")
        rows = first_rows if i == 0 else read_csv(tbl["csv"])
        print(f"  CSV: {len(rows)} rows × {len(rows[0])} cols")

        selects, mselects, longs, atts, links = parse_fields(tbl)
        link_cols = set(links.keys())
        tid = first_tid if (i == 0 and first_tid) else create_table(base_id, tbl, rows)
        rec_ids = upload_records(base_id, tid, rows, link_cols, atts, mselects, tbl["name"])

        pk = tbl["primary_key"]
        pk_map = {}
        for i, row in enumerate(rows):
            if i < len(rec_ids):
                pk_map[row[pk].strip()] = rec_ids[i]

        table_data[tbl["name"]] = {
            "id": tid, "rows": rows, "rec_ids": rec_ids,
            "cfg": tbl, "pk_map": pk_map
        }

    # --- Phase 2: Linked Record 필드 생성 ---
    print(f"\n--- Linked Records ---")
    created_links = {}

    for tbl in cfg["tables"]:
        _, _, _, _, links = parse_fields(tbl)
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
                        _, _, _, _, t2_links = parse_fields(t2)
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
    print(f"\n--- 데이터 연결 ---")

    for tbl in cfg["tables"]:
        _, _, _, _, links = parse_fields(tbl)
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

    # --- Done ---
    print("\n" + "="*60)
    print("COMPLETE!")
    print("="*60)
    for name, d in table_data.items():
        print(f"  {name}: {len(d['rec_ids'])} records ({d['id']})")

if __name__ == "__main__":
    main()
