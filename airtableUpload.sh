#!/bin/bash
# schema.json + CSV 폴더 → Airtable 새 베이스 생성
#
# 사용법:
#   airtableUpload [folder] [--base NAME] [--workspace WS_ID]
#
# 예시:
#   airtableUpload ~/Downloads/sisoso_1.0.1
#   airtableUpload ~/Downloads/sisoso_1.0.1 --base "새프로젝트"
#   airtableUpload ~/Downloads/sisoso_1.0.1 --base "새프로젝트" --workspace wspXXX
#   cd ~/Downloads/sisoso_1.0.1 && airtableUpload   # 현재 폴더 사용

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 첫 인수가 --로 시작하지 않으면 폴더로 처리
if [[ -n "$1" && "$1" != --* ]]; then
    FOLDER="$(cd "$1" 2>/dev/null && pwd)"
    shift
else
    FOLDER="$(pwd)"
fi

if [[ -z "$FOLDER" ]]; then
    echo "오류: 폴더를 찾을 수 없습니다"; exit 1
fi

if [[ ! -f "$FOLDER/schema.json" ]]; then
    echo "오류: schema.json 없음 ($FOLDER)"; exit 1
fi

# base 이름: --base 인수 > 폴더명 기본값
BASE="$(basename "$FOLDER")"
for arg in "$@"; do
    if [[ "$PREV" == "--base" ]]; then BASE="$arg"; fi
    PREV="$arg"
done
VER=$(python3 -c "import json; d=json.load(open('$FOLDER/schema.json')); print(d.get('version','?'))" 2>/dev/null)
echo "▸ base: $BASE  version: $VER"
echo "▸ 폴더: $FOLDER"
[[ -n "$*" ]] && echo "▸ 옵션: $*"
echo ""

cd "$FOLDER"
python3 "$SELF_DIR/airtableGeneric.py" "$@"
