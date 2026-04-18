#!/bin/bash
# myAlgorithmSync.sh
# Obsidian #myAlgorithm 태그 파일 → Airtable myAlgorithm 테이블 upsert
# 사용법: myAlgorithmSync.sh [파일경로]  (없으면 전체 스캔)

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT_DIR="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents"
AIRTABLE_TOKEN="patLUnozLZMaDQIWm.16a031865e7ada4710a3612a8eb0bf1d18661b55b60fbd3f11615627af40c942"
BASE_ID="appjknzoBvztxJvtH"
TABLE_ID="tblQrVX90mrzGSH2n"

CHANGED_FILE="${1:-}"

python3 << PYEOF
import urllib.request, urllib.parse, json, os, glob

TOKEN = "$AIRTABLE_TOKEN"
BASE_ID = "$BASE_ID"
TABLE_ID = "$TABLE_ID"
VAULT_DIR = "$VAULT_DIR"
CHANGED_FILE = "$CHANGED_FILE"

def at_get(path):
    req = urllib.request.Request(f'https://api.airtable.com/v0/{path}',
        headers={'Authorization': f'Bearer {TOKEN}'})
    return json.loads(urllib.request.urlopen(req).read())

def at_request(method, path, data):
    body = json.dumps(data).encode() if data else None
    headers = {'Authorization': f'Bearer {TOKEN}'}
    if body: headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f'https://api.airtable.com/v0/{path}',
        data=body, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(req).read()
        return json.loads(resp) if resp else {}
    except urllib.error.HTTPError as e:
        print(f"  에러 {method}: {e.read().decode()[:200]}")
        return {}

def parse_md(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except:
        return None

    if '#myAlgorithm' not in content:
        return None

    rel_path = os.path.relpath(filepath, VAULT_DIR)
    name = os.path.splitext(os.path.basename(filepath))[0]

    # 첫 번째 비어있지 않은 문단 (태그 줄 제외)
    lines = content.split('\n')
    summary_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith('#myAlgorithm') and not stripped.startswith('---'):
            summary_lines.append(stripped)
            if len(summary_lines) >= 3:
                break
    핵심문장 = ' '.join(summary_lines)[:500]

    return {
        '원칙': name,
        '핵심문장': 핵심문장,
        '근거': content[:5000],
        'obsidian_path': rel_path,
    }

def get_existing_records():
    records = {}
    offset = None
    while True:
        f1 = urllib.parse.quote('원칙')
        url = f'{BASE_ID}/{TABLE_ID}?fields[]={f1}&fields[]=obsidian_path&pageSize=100'
        if offset: url += f'&offset={offset}'
        res = at_get(url)
        for r in res.get('records', []):
            p = r['fields'].get('obsidian_path', '')
            if p: records[p] = r['id']
        offset = res.get('offset')
        if not offset: break
    return records

# 처리할 파일 목록
if CHANGED_FILE and os.path.isfile(CHANGED_FILE):
    files = [CHANGED_FILE]
else:
    files = glob.glob(os.path.join(VAULT_DIR, '**', '*.md'), recursive=True)

existing = get_existing_records()
created, updated, skipped = 0, 0, 0

for filepath in files:
    data = parse_md(filepath)
    if not data:
        skipped += 1
        continue

    rel = data['obsidian_path']
    if rel in existing:
        at_request('PATCH', f'{BASE_ID}/{TABLE_ID}/{existing[rel]}', {'fields': data})
        print(f"  ↺ {data['원칙']}")
        updated += 1
    else:
        at_request('POST', f'{BASE_ID}/{TABLE_ID}', {'records': [{'fields': data}]})
        print(f"  ✚ {data['원칙']}")
        created += 1

print(f"\n완료: 생성 {created}개, 업데이트 {updated}개, 스킵 {skipped}개")
PYEOF
