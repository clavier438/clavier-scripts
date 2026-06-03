#!/bin/bash
# pdf2png — PDF 를 페이지별 PNG 로 분해 (Figma Grid 플러그인 입력용)
# webExporter 가 만든 사이트 PDF 를 "한 장 한 장 펼친" PNG 폴더로 변환한다.
#
# 사용:
#   ./pdf2png.sh <pdf경로> [출력폴더] [DPI=120]
#   ./pdf2png.sh ~/.../books/satoyama-jujo.com/satoyama-jujo.com.pdf
#
# 요구: brew install poppler  (pdftoppm)
set -euo pipefail

PDF="${1:-}"
if [ -z "$PDF" ] || [ ! -f "$PDF" ]; then
  echo "사용: $0 <pdf경로> [출력폴더] [DPI=120]"
  exit 1
fi
if ! command -v pdftoppm >/dev/null 2>&1; then
  echo "[ERROR] pdftoppm 없음 → brew install poppler"
  exit 1
fi

OUT="${2:-${PDF%.pdf}_pages}"
DPI="${3:-120}"
mkdir -p "$OUT"
base="$(basename "${PDF%.pdf}")"

echo "[pdf2png] $PDF"
echo "[pdf2png]   → $OUT/  (DPI $DPI)"
# -png: PNG 출력, 페이지 번호 0패딩 → 이름 정렬 = 페이지 순서
pdftoppm -png -r "$DPI" "$PDF" "$OUT/${base}_page"

n="$(ls "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ')"
echo "[pdf2png] 완료: ${n}장 → $OUT/"
echo "$OUT"
