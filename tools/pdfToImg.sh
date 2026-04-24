#!/usr/bin/env zsh
# pdf2img — PDF 파일을 이미지로 변환하는 스크립트

SCRIPT_NAME="${0:t}"

usage() {
  cat <<EOF
사용법:
  $SCRIPT_NAME [옵션] FILE [FILE...]

옵션:
  -f, --format FORMAT   출력 이미지 포맷 (기본: jpg / 지원: jpg png tiff webp)
  -o, --output DIR      출력 디렉토리 (기본: 원본 파일과 동일한 위치)
  -d, --density DPI     해상도 (기본: 150 DPI)
  -h, --help            도움말 표시

예시:
  $SCRIPT_NAME report.pdf
  $SCRIPT_NAME -f png *.pdf
  $SCRIPT_NAME -f jpg -d 300 -o ./output ./*

참고:
  · 폴더 및 PDF가 아닌 파일은 자동으로 건너뜁니다.
  · 다중 페이지 PDF는 파일명-0.포맷, 파일명-1.포맷 형식으로 저장됩니다.
  · 필수 패키지: brew install imagemagick ghostscript
EOF
}

# ── 의존성 확인 ───────────────────────────────────────────────────────────────
if ! command -v convert &>/dev/null; then
  echo "오류: ImageMagick이 설치되어 있지 않습니다." >&2
  echo "      설치 방법: brew install imagemagick ghostscript" >&2
  exit 1
fi

# ── 기본값 ───────────────────────────────────────────────────────────────────
format="jpg"
output_dir=""
density=150

# ── 옵션 파싱 ─────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--format)
      [[ -z "${2-}" || "${2}" == -* ]] && { echo "오류: $1 뒤에 포맷을 지정하세요." >&2; exit 1; }
      format="${2:l}"
      shift 2 ;;
    -o|--output)
      [[ -z "${2-}" || "${2}" == -* ]] && { echo "오류: $1 뒤에 디렉토리를 지정하세요." >&2; exit 1; }
      output_dir="$2"
      shift 2 ;;
    -d|--density)
      [[ -z "${2-}" || "${2}" == -* ]] && { echo "오류: $1 뒤에 DPI 값을 지정하세요." >&2; exit 1; }
      density="$2"
      shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    --)
      shift; break ;;
    -*)
      echo "알 수 없는 옵션: $1" >&2; echo "" >&2; usage >&2; exit 1 ;;
    *)
      break ;;
  esac
done

if [[ $# -eq 0 ]]; then
  echo "오류: 변환할 파일을 하나 이상 지정하세요." >&2
  echo "" >&2
  usage >&2
  exit 1
fi

# ── 출력 디렉토리 생성 ────────────────────────────────────────────────────────
if [[ -n "$output_dir" ]]; then
  mkdir -p "$output_dir" || { echo "오류: 디렉토리 생성 실패: $output_dir" >&2; exit 1; }
fi

# ── 변환 루프 ─────────────────────────────────────────────────────────────────
converted=0
skipped=0
errors=0

for file in "$@"; do
  # 폴더 건너뜀
  if [[ -d "$file" ]]; then
    echo "[건너뜀] 폴더: $file"
    (( skipped++ )); continue
  fi

  # 존재하지 않는 경로 건너뜀
  if [[ ! -f "$file" ]]; then
    echo "[건너뜀] 파일 없음: $file"
    (( skipped++ )); continue
  fi

  # 확장자가 .pdf 가 아니면 건너뜀 (대소문자 무시)
  if [[ "${file:l}" != *.pdf ]]; then
    echo "[건너뜀] PDF 아님: $file"
    (( skipped++ )); continue
  fi

  base="${file:t:r}"                         # 확장자를 제거한 파일명
  outdir="${output_dir:-${file:h}}"          # 출력 디렉토리 (미지정 시 원본 위치)
  out="${outdir}/${base}.${format}"          # 출력 경로 prefix

  echo "[변환 중] $file  →  $outdir/${base}[...].${format}"

  if convert -density "$density" "$file" "$out" 2>&1; then
    (( converted++ ))
  else
    echo "[오류] 변환 실패: $file" >&2
    (( errors++ ))
  fi
done

echo ""
printf "완료 ─ 변환: %d개  건너뜀: %d개  오류: %d개\n" "$converted" "$skipped" "$errors"
