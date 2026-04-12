#!/usr/bin/env python3
"""
범용 Airtable 업로드 스크립트 v2 (버그 3건 수정)
==================================================
config.json + CSV 파일들만 있으면 어떤 데이터든 에어테이블에 넣음.
테이블 생성, 필드타입, Linked Record까지 전부 자동.

이 파일은 ~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/ 에 상주.
프로젝트 폴더에서 실행하면 그 폴더의 config.json과 CSV를 읽음.

Usage:
  cd /path/to/project_folder
  python ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/scripts/airtable_generic.py

Bugfix v2:
  - Linked Record 옵션: linkedTableId만 사용 (prefersSingleRecordLink 제거)
  - Linked Record 값: 문자열 배열 ["recXXX"] (dict 아님)
  - 422 에러 시 옵션 최소화 자동 재시도
"""

import os, sys, json, time, csv, re, pathlib
import requests

# ============================================================
# PAT 경로 (고정)
# ============================================================
ENV_PATH = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/env.md"
)
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
    p = pathlib.Path(ENV_PATH)
    if not p.exists():
        print(f"ERROR: {ENV_PATH} 없음"); sys.exit(1)
    text = p.read_text(encoding="utf-8")
    m = re.search(r'(pat[A-Za-z0-9_\-\.]{30,})', text)
    if m:
        t = m.group(1); print(f"  PAT: {t[:8]}...{t[-4:]}"); return t
    print("ERROR: PAT 못 찾음"); sys.exit(1)

def call(method, url, data=None):
    for attempt in range(3):
        r = getattr(requests, method)(url, headers=HEADERS, json=data)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", 30))); continue
        if r.status_code >= 400:
            err = r.text[:300]
            print(f"  ERR {r.status_code}: {err}")
            # 422 에러 + options 관련 → 옵션 최소화 재시도
            if r.status_code == 422 and data and data.get("options"):
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

def choices(vals):
    return [{"name":v,"color":COLORS[i%len(COLORS)]} for i,v in enumerate(vals)]

# ============================================================
# CORE
# ============================================================
def find_base(name):
    for b in call("get", f"{META}/bases").get("bases",[]):
        if b["name"].lower() == name.lower():
            print(f"  Base: {b['name']} → {b['id']}"); return b["id"]
    print(f"  ERROR: '{name}' 없음"); sys.exit(1)

def create_table(base_id, tbl_cfg, rows):
    selects = set(tbl_cfg.get("singleSelect", []))
    longs = set(tbl_cfg.get("multilineText", []))
    link_cols = set(tbl_cfg.get("links", {}).keys())

    fields = []
    for col in rows[0].keys():
        if col in link_cols:
            continue
        if col in selects:
            fields.append({"name":col, "type":"singleSelect",
                          "options":{"choices":choices(unique(rows,col))}})
        elif col in longs:
            fields.append({"name":col, "type":"multilineText"})
        else:
            fields.append({"name":col, "type":"singleLineText"})

    res = call("post", f"{META}/bases/{base_id}/tables",
               {"name": tbl_cfg["name"], "fields": fields})
    tid = res["id"]
    print(f"  Created: {tbl_cfg['name']} → {tid}")
    return tid

def upload_records(base_id, table_id, rows, exclude, name):
    ids = []
    clean = [{k:v for k,v in r.items() if k not in exclude and v.strip()} for r in rows]
    for i in range(0, len(clean), 10):
        res = call("post", f"{API}/{base_id}/{table_id}",
                   {"records":[{"fields":r} for r in clean[i:i+10]]})
        if res:
            ids.extend(r["id"] for r in res.get("records",[]))
        print(f"    {name}: {len(ids)}/{len(clean)}")
        time.sleep(0.3)
    return ids

def resolve(csv_val, id_map):
    """콤마 구분 텍스트 → record ID 문자열 배열 (v2: dict 아님!)"""
    if not csv_val or csv_val.strip() in ("","없음","-"): return []
    ids = []
    for part in [p.strip() for p in csv_val.split(",")]:
        # 정확 매칭
        if part in id_map:
            ids.append(id_map[part]); continue
        # 괄호 제거 후 매칭
        clean = re.sub(r'\s*\(.*?\)','',part).strip()
        if clean in id_map:
            ids.append(id_map[clean]); continue
        # 부분 매칭
        for name, rid in id_map.items():
            if part in name or name in part:
                ids.append(rid); break
    return ids

# ============================================================
# MAIN
# ============================================================
def main():
    print("="*60)
    print("Airtable 범용 업로더 v2")
    print("="*60)

    cfg_path = pathlib.Path("config.json")
    if not cfg_path.exists():
        print("ERROR: config.json 없음"); sys.exit(1)
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    print(f"  Config: {len(cfg['tables'])}개 테이블")

    pat = load_pat()
    HEADERS["Authorization"] = f"Bearer {pat}"
    HEADERS["Content-Type"] = "application/json"

    base_id = find_base(cfg["base"])

    # --- Phase 1: 테이블 생성 + 데이터 업로드 ---
    table_data = {}

    for tbl in cfg["tables"]:
        print(f"\n--- {tbl['name']} ---")
        rows = read_csv(tbl["csv"])
        print(f"  CSV: {len(rows)} rows × {len(rows[0])} cols")

        link_cols = set(tbl.get("links",{}).keys())
        tid = create_table(base_id, tbl, rows)
        rec_ids = upload_records(base_id, tid, rows, link_cols, tbl["name"])

        pk = tbl["primary"]
        pk_map = {}
        for i, row in enumerate(rows):
            if i < len(rec_ids):
                pk_map[row[pk].strip()] = rec_ids[i]

        table_data[tbl["name"]] = {
            "id": tid, "rows": rows, "rec_ids": rec_ids,
            "cfg": tbl, "pk_map": pk_map
        }

    # --- Phase 2: Linked Record 생성 (v2: linkedTableId만 사용) ---
    print(f"\n--- Linked Records ---")
    created_links = {}

    for tbl in cfg["tables"]:
        links = tbl.get("links", {})
        if not links: continue
        src = table_data[tbl["name"]]

        for link_col, link_cfg in links.items():
            target_name = link_cfg["target_table"]
            tgt = table_data[target_name]

            reverse_key = (target_name, tbl["name"])
            if reverse_key in created_links:
                print(f"  {tbl['name']}.{link_col} — 역방향 이미 생성됨, 스킵")
                continue

            print(f"  생성: {tbl['name']}.{link_col} → {target_name}")
            res = call("post", f"{META}/bases/{base_id}/tables/{src['id']}/fields", {
                "name": link_col,
                "type": "multipleRecordLinks",
                "options": {"linkedTableId": tgt["id"]}  # v2: 이것만!
            })

            fid = res["id"]
            inv_fid = res.get("options",{}).get("inverseLinkFieldId")
            created_links[(tbl["name"], target_name)] = fid

            if inv_fid:
                inv_name = None
                for t2 in cfg["tables"]:
                    if t2["name"] == target_name:
                        for lc, lcfg in t2.get("links",{}).items():
                            if lcfg["target_table"] == tbl["name"]:
                                inv_name = lc; break
                if inv_name:
                    print(f"  역방향 필드 rename → '{inv_name}'")
                    call("patch",
                         f"{META}/bases/{base_id}/tables/{tgt['id']}/fields/{inv_fid}",
                         {"name": inv_name})
                    created_links[(target_name, tbl["name"])] = inv_fid

    # --- Phase 3: 링크 데이터 연결 (v2: 문자열 배열) ---
    print(f"\n--- 데이터 연결 ---")

    for tbl in cfg["tables"]:
        links = tbl.get("links", {})
        if not links: continue
        src = table_data[tbl["name"]]

        for link_col, link_cfg in links.items():
            tgt = table_data[link_cfg["target_table"]]

            updates = []
            for i, row in enumerate(src["rows"]):
                if i >= len(src["rec_ids"]): break
                resolved = resolve(row.get(link_col,""), tgt["pk_map"])
                if resolved:
                    updates.append({
                        "id": src["rec_ids"][i],
                        "fields": {link_col: resolved}  # v2: ["recXXX"] 문자열 배열
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
    print(f"\n  수동 작업: 없음")

if __name__ == "__main__":
    main()