#!/bin/bash
# schema.json + CSV 폴더 → Airtable 새 베이스 생성
# 사용법: airtableUpload [folder]
#   folder 생략 시 현재 디렉토리
# 예시:
#   airtableUpload ~/Downloads/sisoso_1.0.1
#   cd ~/Downloads/sisoso_1.0.1 && airtableUpload

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOLDER="${1:-.}"
FOLDER="$(cd "$FOLDER" 2>/dev/null && pwd)"

if [[ -z "$FOLDER" ]]; then
    echo "오류: 폴더를 찾을 수 없습니다: $1"; exit 1
fi

if [[ ! -f "$FOLDER/schema.json" ]]; then
    echo "오류: schema.json 없음 ($FOLDER)"; exit 1
fi

BASE=$(python3 -c "import json; d=json.load(open('$FOLDER/schema.json')); print(d.get('base','?'))" 2>/dev/null)
VER=$(python3 -c "import json; d=json.load(open('$FOLDER/schema.json')); print(d.get('version','?'))" 2>/dev/null)
echo "▸ base: $BASE  version: $VER"
echo "▸ 폴더: $FOLDER"
echo ""

cd "$FOLDER"
python3 "$SELF_DIR/airtableGeneric.py"
