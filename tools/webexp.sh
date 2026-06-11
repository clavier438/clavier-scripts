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
#   --harvest-images 썸네일 제외 이미지를 nav 카테고리별로 다운로드 → Mac 으로 images/ pull
#   --img-min-dim N  썸네일 임계 px (default 200, --harvest-images 와 함께)
#   --no-pull        Mac 으로 PDF auto-pull skip
#   -h | --help      이 메시지
#
# 여러 URL: 순차 실행 (single-thread). 각 URL 사이 60초 sleep.

. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/freshness.sh"
. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/repoPaths.sh"

set -euo pipefail

OCI="ubuntu@168.107.63.94"
ICLOUD_RESULTS="$CLAVIER_SCRIPTS/webExporter/oci-results"
mkdir -p "$ICLOUD_RESULTS"

# 기본값
MODE="pagination"
NAV_CAP=10
PREFIX_CAP=3
SKIP_MOBILE=""
NO_PULL=""
HARVEST=""
IMG_MIN_DIM=""
URLS=()

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      sed -n '2,24p' "$0" | sed 's/^# //; s/^#//'; exit 0 ;;
    --full)           MODE="full"; shift ;;
    --pagination)     MODE="pagination"; shift ;;
    --single)         MODE="single"; shift ;;
    --nav-cap)        NAV_CAP="$2"; shift 2 ;;
    --prefix-cap)     PREFIX_CAP="$2"; shift 2 ;;
    --skip-mobile)    SKIP_MOBILE="mobile"; shift ;;
    --harvest-images) HARVEST="1"; shift ;;
    --img-min-dim)    IMG_MIN_DIM="$2"; shift 2 ;;
    --no-pull)        NO_PULL="1"; shift ;;
    http*)            URLS+=("$1"); shift ;;
    *)                echo "unknown: $1"; exit 1 ;;
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
[ -n "$SKIP_MOBILE" ]  && ENV_VARS="$ENV_VARS WEBEXP_SKIP_VIEWPORTS=$SKIP_MOBILE"
[ -n "$IMG_MIN_DIM" ]  && ENV_VARS="$ENV_VARS WEBEXP_IMG_MIN_DIM=$IMG_MIN_DIM"

# python 추가 플래그
PY_FLAGS=""
[ -n "$HARVEST" ] && PY_FLAGS="$PY_FLAGS --harvest-images"

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

  OUT_DIR="~/webexporter-output/${SLUG}-${TS}"
  ssh "$OCI" "cd ~/clavier-scripts/webExporter && \
    $ENV_VARS ~/webexporter-venv/bin/python webSiteExporter.py '$URL' \
      --output $OUT_DIR \
      --max-pages $MAX_PAGES \
      --concurrency 1$PY_FLAGS 2>&1 | tee ~/webexporter-logs/$LOG" || echo "[WARN] $URL fail"

  # PDF pull
  if [ -z "$NO_PULL" ]; then
    REMOTE_PDF=$(ssh "$OCI" "ls -t /home/ubuntu/webexporter-output/${SLUG}-${TS}/*.pdf 2>/dev/null | head -1")
    if [ -n "$REMOTE_PDF" ]; then
      LOCAL_PDF="$ICLOUD_RESULTS/${SLUG}-${MODE}-${TS}.pdf"
      scp "$OCI:$REMOTE_PDF" "$LOCAL_PDF"
      echo "✓ saved: $(basename "$LOCAL_PDF")"
    else
      echo "✗ PDF 못 찾음 — log 확인: ~/webexporter-logs/$LOG"
    fi

    # 이미지 harvest 결과(images/ = 카테고리별 폴더 + manifest.json) pull
    if [ -n "$HARVEST" ]; then
      REMOTE_IMG="/home/ubuntu/webexporter-output/${SLUG}-${TS}/images"
      if ssh "$OCI" "[ -d $REMOTE_IMG ]"; then
        LOCAL_IMG="$ICLOUD_RESULTS/${SLUG}-${MODE}-${TS}-images"
        mkdir -p "$LOCAL_IMG"
        scp -r "$OCI:$REMOTE_IMG/." "$LOCAL_IMG/" >/dev/null 2>&1 \
          && echo "✓ images: $(basename "$LOCAL_IMG")/ (nav 카테고리별 + manifest.json)" \
          || echo "✗ images pull 실패"
      else
        echo "✗ images/ 없음 — 비-썸네일 이미지 0 이었을 수 있음"
      fi
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
