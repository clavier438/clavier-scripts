#!/usr/bin/env zsh
# img2web.sh — 이미지 파일을 웹용으로 변환 (다중 파일 / glob 지원)
# 사용법: ./img2web.sh [옵션] <파일 또는 glob...>
#
# 옵션:
#   -f webp|jpg|png   출력 포맷 (기본: webp)
#   -q <1-100>        품질 (기본: 82)
#   -w <픽셀>          최대 너비 (기본: 1920, 0이면 원본 유지)
#   -d <디렉토리>      출력 디렉토리 (기본: 원본 파일과 같은 위치)

set -euo pipefail

# ── 기본값 ──────────────────────────────────────────────────
FORMAT="webp"
QUALITY=82
MAX_WIDTH=1920
OUTDIR=""

# ── 도움말 ──────────────────────────────────────────────────
usage() {
  cat <<EOF
사용법: $(basename "$0") [옵션] <파일 또는 glob...>

glob 패턴(./* 등)을 넣으면 이미지 파일만 자동으로 걸러냅니다.
지원 확장자: jpg, jpeg, png, gif, heic, heif, bmp, tiff, tif, webp, avif

옵션:
  -f webp|jpg|png   출력 포맷 (기본: webp)
  -q <1-100>        품질 (기본: 82)
  -w <픽셀>          최대 너비 (기본: 1920, 0이면 원본 유지)
  -d <디렉토리>      출력 디렉토리 (기본: 원본 파일과 같은 위치)

예시:
  $(basename "$0") photo.jpg
  $(basename "$0") ./*                          # 현재 폴더 이미지 전체
  $(basename "$0") ~/Downloads/*                # 다른 폴더 전체
  $(basename "$0") -f webp -q 75 -w 1280 ./*
  $(basename "$0") -d ./output a.jpg b.png c.heic
EOF
  exit 1
}

# ── 옵션 파싱 (옵션은 파일 목록 앞에) ──────────────────────
while getopts "f:q:w:d:h" opt; do
  case $opt in
    f) FORMAT="${OPTARG:l}" ;;   # 소문자로 정규화
    q) QUALITY="$OPTARG" ;;
    w) MAX_WIDTH="$OPTARG" ;;
    d) OUTDIR="$OPTARG" ;;
    h) usage ;;
    *) usage ;;
  esac
done
shift $(( OPTIND - 1 ))

[[ $# -eq 0 ]] && usage

# ── 포맷 검증 ────────────────────────────────────────────────
case "$FORMAT" in
  webp|jpg|jpeg|png) ;;
  *)
    echo "❌ 지원하지 않는 포맷: $FORMAT (webp / jpg / png 중 선택)" >&2
    exit 1
    ;;
esac
[[ "$FORMAT" == "jpeg" ]] && FORMAT="jpg"

# WebP 변환 도구 사전 확인
if [[ "$FORMAT" == "webp" ]] && ! command -v cwebp &>/dev/null; then
  echo "❌ cwebp 미설치. 설치: brew install webp" >&2
  exit 1
fi

# ── 이미지 파일 판별 함수 ────────────────────────────────────
IMAGE_EXTS=(jpg jpeg png gif heic heif bmp tiff tif webp avif)
is_image() {
  local ext="${1:l:e}"   # zsh: 소문자 확장자 추출
  for e in "${IMAGE_EXTS[@]}"; do
    [[ "$ext" == "$e" ]] && return 0
  done
  return 1
}

# ── 파일 목록 수집 (이미지만 필터링) ────────────────────────
typeset -a FILES
for arg in "$@"; do
  if [[ -f "$arg" ]] && is_image "$arg"; then
    FILES+=("$arg")
  fi
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "❌ 변환할 이미지 파일이 없습니다." >&2
  exit 1
fi

# ── 출력 디렉토리 생성 ───────────────────────────────────────
[[ -n "$OUTDIR" ]] && mkdir -p "$OUTDIR"

echo "📂 ${#FILES[@]}개 파일 변환 시작  [포맷: ${FORMAT} | 품질: ${QUALITY} | 최대 너비: ${MAX_WIDTH}px]"
echo ""

# ── 단일 파일 변환 함수 ──────────────────────────────────────
convert_one() {
  local INPUT="$1"
  local BASENAME="${INPUT:t:r}"
  local DEST_DIR="${OUTDIR:-${INPUT:h}}"
  local OUTPUT="${DEST_DIR}/${BASENAME}_web.${FORMAT}"

  mkdir -p "$DEST_DIR"

  # 임시 파일 (sips 중간 변환용)
  local TMP_FILE
  TMP_FILE=$(mktemp /tmp/img2web_XXXXXX.png)

  # 원본 너비 확인 후 리사이즈
  local ORIG_WIDTH
  ORIG_WIDTH=$(sips -g pixelWidth "$INPUT" 2>/dev/null | awk '/pixelWidth/ {print $2}')

  if [[ "$MAX_WIDTH" -gt 0 && -n "$ORIG_WIDTH" && "$ORIG_WIDTH" -gt "$MAX_WIDTH" ]]; then
    sips -Z "$MAX_WIDTH" "$INPUT" --out "$TMP_FILE" &>/dev/null
  else
    cp "$INPUT" "$TMP_FILE"
  fi

  # 포맷 변환
  case "$FORMAT" in
    webp)
      cwebp -q "$QUALITY" "$TMP_FILE" -o "$OUTPUT" 2>/dev/null ;;
    jpg)
      sips -s format jpeg -s formatOptions "$QUALITY" "$TMP_FILE" --out "$OUTPUT" &>/dev/null ;;
    png)
      sips -s format png "$TMP_FILE" --out "$OUTPUT" &>/dev/null ;;
  esac

  rm -f "$TMP_FILE"

  # 크기 비교 출력
  local ORIG_SIZE OUT_SIZE RATIO
  ORIG_SIZE=$(stat -f%z "$INPUT")
  OUT_SIZE=$(stat -f%z "$OUTPUT")
  if [[ "$ORIG_SIZE" -gt 0 ]]; then
    RATIO=$(( (ORIG_SIZE - OUT_SIZE) * 100 / ORIG_SIZE ))
  else
    RATIO=0
  fi

  printf "  ✅ %-35s → %-35s (%d%% 감소)\n" \
    "$(basename "$INPUT")" "$(basename "$OUTPUT")" "$RATIO"
}

# ── 일괄 변환 ────────────────────────────────────────────────
SUCCESS=0
FAIL=0
for f in "${FILES[@]}"; do
  if convert_one "$f" 2>/dev/null; then
    SUCCESS=$(( SUCCESS + 1 ))
  else
    printf "  ❌ 실패: %s\n" "$(basename "$f")" >&2
    FAIL=$(( FAIL + 1 ))
  fi
done

echo ""
echo "🎉 완료: ${SUCCESS}개 성공$([ "$FAIL" -gt 0 ] && echo ", ${FAIL}개 실패" || echo "")"
