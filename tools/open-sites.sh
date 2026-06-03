#!/bin/bash
. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/freshness.sh"

# Usage:
#   ./open-sites.sh [csv_file] [batch_size] [url_column]
#
#   csv_file   : CSV 파일 경로 (기본: ~/Desktop/baton-clients-live.csv)
#   batch_size : 한 번에 열 개수 (기본: 5)
#   url_column : URL이 있는 열 번호 (기본: 2)

CSV="${1:-$HOME/Desktop/baton-clients-live.csv}"
BATCH="${2:-5}"
COL="${3:-2}"

if [[ ! -f "$CSV" ]]; then
  echo "파일 없음: $CSV"
  exit 1
fi

urls=($(awk -F',' -v col="$COL" 'NR>1 {gsub(/\r/,"",$col); if ($col!="") print $col}' "$CSV"))
total=${#urls[@]}
i=0

echo "파일: $(basename "$CSV")  |  총 $total 개  |  ${BATCH}개씩"
echo "--------------------------------------------"

while [ $i -lt $total ]; do
  batch=("${urls[@]:$i:$BATCH}")
  echo ""
  echo "[$((i+1))–$((i+${#batch[@]})) / $total]"
  for url in "${batch[@]}"; do
    echo "  $url"
  done
  read -r -p "엔터 → 오픈  (q → 종료): " input
  [[ "$input" == "q" ]] && echo "종료." && exit 0
  for url in "${batch[@]}"; do
    open "$url"
  done
  i=$((i + BATCH))
done

echo ""
echo "모두 완료."
