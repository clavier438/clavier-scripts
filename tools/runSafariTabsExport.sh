#!/bin/bash
# Safari 탭 일괄 PDF 내보내기
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/0/books"
SCRIPT="$SELF_DIR/webExporter/webPdfExporter.sh"
LOG="$SELF_DIR/safari_export_$(date +%Y%m%d_%H%M%S).log"

URLS=(
  "https://www.aman.com/"
  "https://www.aman.com/stories/urban-escapes"
  "https://www.aman.com/hotels/aman-nai-lert-bangkok"
  "https://www.aman.com/Aman-Nai-Lert-Bangkok-Spa-Menu"
  "https://www.aman.com/hotels/aman-new-york"
  "https://www.aman.com/hotels/aman-venice"
  "https://www.filippa-k.com/us/en/sustainability.html"
  "https://noma.dk/"
  "https://sanalabs.com/customers/learning/spotify"
  "https://www.vogue.com/"
  "https://winkreative.com/"
  "https://torralbenc.com/"
  "https://explorajourneys.com/int/en/life-on-explora/dining"
  "https://www.hana-mura.com/english/cuisine/"
  "https://www.thefp.com/"
  "https://conway.world/"
  "https://happyplates.com/"
  "https://slite.com/blog"
  "https://www.patternbrands.com/"
  "https://festival.mmilens.fr/"
  "https://gumroad.com/blog"
  "https://www.lovieawards.com/"
  "https://www.bruxaofficial.com/"
  "https://hannun.com/en"
  "https://ossou.com/"
  "https://intl.nothing.tech/"
  "https://faceformula.com/"
  "https://www.usequanta.com/"
  "https://gelcare.com/"
  "https://www.happyrobot.ai/"
  "https://thefootprintfirm.com/"
  "https://stephaneissartel.com/"
  "https://www.kynandfolk.com/"
  "https://emergencemagazine.org/"
  "https://halemercantile.com/"
  "https://pilcrow.no/"
  "https://stele.ca/"
  "https://www.dilli.house/"
  "https://andermatt-realestate.ch/"
  "https://www.911rennsport.co.uk/"
  "https://giellygreen.co.uk/"
  "https://conceptbarre.com/"
  "https://www.studiodado.com/"
  "https://thebrecon.com/en/"
  "https://flussbad.com/"
  "https://missionlab.ie/"
  "https://www.rayisaplace.com/"
  "https://cerve.com/"
)

TOTAL=${#URLS[@]}
SUCCESS=0
FAIL=0

echo "====================================" | tee -a "$LOG"
echo "Safari 탭 PDF 내보내기 시작: $(date)" | tee -a "$LOG"
echo "총 ${TOTAL}개 사이트" | tee -a "$LOG"
echo "출력: $OUTPUT_DIR" | tee -a "$LOG"
echo "====================================" | tee -a "$LOG"

for i in "${!URLS[@]}"; do
  URL="${URLS[$i]}"
  NUM=$((i+1))
  echo "" | tee -a "$LOG"
  echo "[$NUM/$TOTAL] $URL" | tee -a "$LOG"
  echo "------------------------------------" | tee -a "$LOG"
  if bash "$SCRIPT" "$URL" -o "$OUTPUT_DIR" -m 5 -s 10 2>&1 | tee -a "$LOG"; then
    SUCCESS=$((SUCCESS+1))
  else
    FAIL=$((FAIL+1))
    echo "  [FAIL] $URL" | tee -a "$LOG"
  fi
done

echo "" | tee -a "$LOG"
echo "====================================" | tee -a "$LOG"
echo "완료: $(date)" | tee -a "$LOG"
echo "성공: $SUCCESS / 실패: $FAIL / 전체: $TOTAL" | tee -a "$LOG"
echo "로그: $LOG" | tee -a "$LOG"
echo "====================================" | tee -a "$LOG"
