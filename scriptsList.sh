#!/usr/bin/env zsh
# scriptsList.sh — iCloud/0/scripts/ 내 스크립트 목록 및 설명 출력

SCRIPTS_DIR="${SCRIPTS_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/0/scripts}"

# ── 색상 ────────────────────────────────────────────────────
BOLD='\033[1m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
RESET='\033[0m'

# ── 설명 추출 함수 ──────────────────────────────────────────
extract_desc() {
  local file="$1"
  local desc=""

  desc=$(grep -m1 -E "^#[[:space:]].*[—:\-]" "$file" 2>/dev/null \
    | sed -E 's/^#[[:space:]]+(.*[—:-][[:space:]]*)//' | sed 's/^[[:space:]]*//')

  if [[ -z "$desc" ]]; then
    desc=$(grep -m3 "^#" "$file" 2>/dev/null \
      | grep -v "^#!/" \
      | head -1 \
      | sed 's/^#[[:space:]]*//')
  fi

  [[ -z "$desc" ]] && desc="-"
  echo "$desc"
}

# ── 파일 출력 함수 ──────────────────────────────────────────
print_entry() {
  local label="$1"
  local desc="$2"
  printf "  ${YELLOW}%-42s${RESET} %s\n" "$label" "$desc"
}

print_daemon_entry() {
  local label="$1"
  local desc="$2"
  printf "  ${MAGENTA}%-42s${RESET} %s\n" "$label" "$desc"
}

# ── 헤더 ────────────────────────────────────────────────────
echo ""
echo "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}${CYAN}║            사용 가능한 스크립트 목록                         ║${RESET}"
echo "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo "${DIM}  위치: $SCRIPTS_DIR${RESET}"
echo ""

# ── 데몬 섹션 ───────────────────────────────────────────────
echo "${BOLD}${MAGENTA}  [ daemons ]${RESET}"
echo "  $(printf '%.0s─' {1..60})"

for ext in sh; do
  for f in "$SCRIPTS_DIR/daemons"/*.$ext(N); do
    [[ -f "$f" ]] || continue
    name="$(basename "${f%.*}")"
    desc="$(extract_desc "$f")"
    print_daemon_entry "$name" "$desc"
  done
done

# ── 루트 스크립트 섹션 ──────────────────────────────────────
echo ""
echo "${BOLD}  [ scripts ]${RESET}"
echo "  $(printf '%.0s─' {1..60})"

for ext in sh py jsx; do
  for f in "$SCRIPTS_DIR"/*.$ext(N); do
    [[ -f "$f" ]] || continue
    name="$(basename "${f%.*}")"
    desc="$(extract_desc "$f")"
    print_entry "$name" "$desc"
  done
done

# ── 서브폴더 자동 감지 (SvelteKit 방식) ────────────────────
# 폴더를 추가하면 자동으로 섹션이 생긴다. 하드코딩 없음.
SKIP_DIRS=("daemons" "memory-backup" "backup" ".git" ".claude" "PDF to JPEG.app" "PDF to JPEG.workflow" "webExporter" "Markdown2ID")

is_skipped() {
  local name="$1"
  for s in "${SKIP_DIRS[@]}"; do [[ "$name" == "$s" ]] && return 0; done
  return 1
}

for subdir in "$SCRIPTS_DIR"/*(N/); do
  dir_name="$(basename "$subdir")"
  is_skipped "$dir_name" && continue

  # clouds/ 는 2단계 구조: clouds/{svc}/ 별로 섹션
  if [[ "$dir_name" == "clouds" ]]; then
    for svcdir in "$subdir"/*(N/); do
      svc_name="$(basename "$svcdir")"
      echo ""
      echo "${BOLD}  [ clouds/$svc_name ]${RESET}"
      echo "  $(printf '%.0s─' {1..60})"
      for f in "$svcdir"/*.{sh,py}(N); do
        [[ -f "$f" ]] || continue
        name="$(basename "${f%.*}")"
        desc="$(extract_desc "$f")"
        print_entry "$name" "$desc"
      done
    done
    continue
  fi

  echo ""
  echo "${BOLD}  [ $dir_name ]${RESET}"
  echo "  $(printf '%.0s─' {1..60})"
  for f in "$subdir"/*.{sh,py,jsx}(N); do
    [[ -f "$f" ]] || continue
    name="$(basename "${f%.*}")"
    desc="$(extract_desc "$f")"
    print_entry "$name" "$desc"
  done
done

# ── 앱 / 워크플로우 ─────────────────────────────────────────
echo ""
echo "${BOLD}  [ apps ]${RESET}"
echo "  $(printf '%.0s─' {1..60})"
[[ -d "$SCRIPTS_DIR/PDF to JPEG.app" ]]      && print_entry "PDF to JPEG.app"      "PDF → JPEG Automator 앱 번들"
[[ -f "$SCRIPTS_DIR/PDF to JPEG.workflow" ]] && print_entry "PDF to JPEG.workflow" "PDF → JPEG Finder Quick Action 워크플로우"

echo ""
echo "${DIM}  데몬 시작/중지: syncObsidian start|stop|status${RESET}"
echo ""
