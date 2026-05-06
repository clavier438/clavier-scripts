#!/bin/bash
# webexp — OCI 측 webExporter 한 번에 실행 + Mac 으로 PDF pull
# 사용법:
#   webexp <url1> [<url2> ...] [--full | --pagination | --single] [--nav-cap N] [--prefix-cap N] [옵션...]
#
# 페이지네이션 모드:
#   --single       max-pages 1 (홈만, 가장 빠름 ~3분/url)
#   --pagination   max-pages 3 (홈 + nav 2~3개, ~10분/url, default)
#   --full         max-pages 0 + nav cap 적용 (전체 nav, ~30-60분/url)
#
# 추가 옵션:
#   --nav-cap N      NAV_TOTAL_CAP override (default 10, --full 일 때만)
#   --prefix-cap N   prefix 별 max (default 3, --full 일 때만)
#   --skip-mobile    mobile viewport skip (메모리 절약)
#   --no-pull        Mac 으로 PDF auto-pull skip
#   -h | --help      이 메시지
#
# 여러 URL: 순차 실행 (single-thread). 각 URL 사이 60초 sleep.

set -euo pipefail

OCI="ubuntu@168.107.63.94"
ICLOUD_RESULTS="$HOME/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/webExporter/oci-results"

# 기본값
MODE="pagination"
NAV_CAP=10
PREFIX_CAP=3
SKIP_MOBILE=""
NO_PULL=""
URLS=()

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# //; s/^#//'; exit 0 ;;
    --full)        MODE="full"; shift ;;
    --pagination)  MODE="pagination"; shift ;;
    --single)      MODE="single"; shift ;;
    --nav-cap)     NAV_CAP="$2"; shift 2 ;;
    --prefix-cap)  PREFIX_CAP="$2"; shift 2 ;;
    --skip-mobile) SKIP_MOBILE="mobile"; shift ;;
    --no-pull)     NO_PULL="1"; shift ;;
    http*)         URLS+=("$1"); shift ;;
    *)             echo "unknown: $1"; exit 1 ;;
  esac
done

if [ ${#URLS[@]} -eq 0 ]; then
  echo "사용법: webexp <url> [<url2> ...] [--full|--pagination|--single] [옵션...]"
  echo "         webexp --help 로 자세히"
  exit 1
fi

# max-pages 결정
case "$MODE" in
  single)     MAX_PAGES=1 ;;
  pagination) MAX_PAGES=3 ;;
  full)       MAX_PAGES=0 ;;
esac

# 환경변수 조립
ENV_VARS="WEBEXP_NAV_TOTAL_CAP=$NAV_CAP WEBEXP_NAV_PREFIX_CAP=$PREFIX_CAP"
[ -n "$SKIP_MOBILE" ] && ENV_VARS="$ENV_VARS WEBEXP_SKIP_VIEWPORTS=$SKIP_MOBILE"

TOTAL=${#URLS[@]}
echo "▶ webexp ($TOTAL URL, mode=$MODE)"
for u in "${URLS[@]}"; do echo "    - $u"; done
echo ""

# OCI sync 한 번만 (모든 URL 공유)
ssh "$OCI" "cd ~/clavier-scripts/webExporter && \
  git fetch origin main --quiet && git reset --hard origin/main --quiet && \
  echo '  head: '\$(git log --oneline -1)"
echo ""

IDX=0
for URL in "${URLS[@]}"; do
  IDX=$((IDX + 1))
  SLUG=$(echo "$URL" | sed -E 's|^https?://||; s|/.*||; s|\.|_|g')
  TS=$(date +%Y%m%d-%H%M%S)
  LOG="webexp-${SLUG}-${MODE}-${TS}.log"

  echo "═══════════════════════════════════"
  echo "  [${IDX}/${TOTAL}] ▶ $URL"
  echo "═══════════════════════════════════"

  ssh "$OCI" "cd ~/clavier-scripts/webExporter && \
    $ENV_VARS ~/webexporter-venv/bin/python feedback_loop.py '$URL' \
      --criteria criteria_mukayu.json \
      --output ~/webexporter-output \
      --max-pages $MAX_PAGES \
      --concurrency 1 \
      --max-retries 1 2>&1 | tee ~/webexporter-logs/$LOG" || echo "[WARN] $URL fail"

  # PDF pull
  if [ -z "$NO_PULL" ]; then
    REMOTE_PDF=$(ssh "$OCI" "ls -t /home/ubuntu/webexporter-output/${SLUG}-*/[a-z]*.pdf 2>/dev/null | head -1")
    if [ -n "$REMOTE_PDF" ]; then
      LOCAL_PDF="$ICLOUD_RESULTS/${SLUG}-${MODE}-${TS}.pdf"
      scp "$OCI:$REMOTE_PDF" "$LOCAL_PDF"
      echo "✓ saved: $(basename "$LOCAL_PDF")"
    else
      echo "✗ PDF 못 찾음 — log 확인: ~/webexporter-logs/$LOG"
    fi
  fi

  # 다음 URL 사이 sleep (마지막 빼고)
  if [ "$IDX" -lt "$TOTAL" ]; then
    echo ""
    echo "  sleep 60s before next..."
    sleep 60
  fi
done

echo ""
echo "═══════════════════════════════════"
echo "  ✓ 모두 완료 ($TOTAL URL)"
[ -z "$NO_PULL" ] && open "$ICLOUD_RESULTS"
echo "═══════════════════════════════════"
