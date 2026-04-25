#!/usr/bin/env zsh
# scripts — 전역 명령어 목록을 트리+설명 형태로 출력

BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
CYAN=$'\033[36m'; YELLOW=$'\033[33m'; RESET_ALL=$'\033[0m'

SRC="${HOME}/Library/Mobile Documents/com~apple~CloudDocs/0/scripts"

# ── 파일 설명 추출 ─────────────────────────────────────────
_desc() {
    local f="$1" d=""
    [[ -f "$f" ]] || { echo "-"; return }
    case "$f" in
        *.mjs|*.js)
            d=$(grep -m1 -E "^\s*(//|\*)\s.+—" "$f" 2>/dev/null \
                | sed 's/.*—[[:space:]]*//' | sed 's/[[:space:]]*\*\/$//' | tr -d '\n')
            [[ -z "$d" ]] && d=$(grep -m5 -E "^\s*(\*[^/]|//)" "$f" 2>/dev/null \
                | grep -v "^\s*\*\s*$\|@\|usage\|Usage\|사용법" | head -1 \
                | sed 's|^\s*\*[[:space:]]*||;s|^\s*//[[:space:]]*||' | tr -d '\n')
            ;;
        *)
            d=$(grep -m1 -E "^#\s.+—" "$f" 2>/dev/null \
                | awk -F'—' '{print $NF}' | sed 's/^[[:space:]]*//' | tr -d '\n')
            [[ -z "$d" ]] && d=$(grep -m8 "^#" "$f" 2>/dev/null \
                | grep -v "^#!/\|^#[[:space:]]*$" \
                | grep -v "^#[[:space:]]*[=─\-]\{3,\}" \
                | head -1 | sed 's/^#[[:space:]]*//' | tr -d '\n')
            ;;
    esac
    echo "${d:--}"
}

# ── 한 줄 출력 ─────────────────────────────────────────────
_row() {
    local last="$1" prefix="$2" stem="$3" desc="$4" clr="${5:-$YELLOW}"
    local br; [[ "$last" == 1 ]] && br="└──" || br="├──"
    printf "%s${DIM}%s${RESET} ${clr}%-26s${RESET} ${DIM}%s${RESET}\n" \
        "$prefix" "$br" "$stem" "$desc"
}

# ── 섹션 출력 ─────────────────────────────────────────────
_section() {
    local label="$1" dir="$2" is_last="$3"
    local br; [[ "$is_last" == 1 ]] && br="└──" || br="├──"

    local -a entries=()
    local ext f
    for ext in sh mjs py js rb; do
        for f in "$dir"/*.$ext(N); do
            [[ -f "$f" ]] && entries+=("$f")
        done
    done
    [[ ${#entries} -eq 0 ]] && return

    echo "${DIM}│${RESET}"
    echo "${DIM}${br}${RESET} ${BOLD}${CYAN}[ ${label} ]${RESET}"

    local total=${#entries} idx=0
    local stem d last  # 루프 밖에서 한 번만 선언
    for f in "${entries[@]}"; do
        ((idx++))
        stem="${${f:t}%.*}"; d=""; last=0
        [[ "$idx" == "$total" ]] && last=1
        d=$(_desc "$f")
        _row "$last" "│   " "$stem" "$d"
    done
}

# ── 메인 ───────────────────────────────────────────────────
_main() {
    echo ""
    echo "${BOLD}${CYAN}clavier-scripts${RESET}  ${DIM}(전역 명령어 목록 / ~/bin)${RESET}"
    echo "${DIM}│${RESET}"

    # [ scripts ] — 루트 + tools/ 합산
    echo "${DIM}├──${RESET} ${BOLD}${CYAN}[ scripts ]${RESET}  ${DIM}(루트 + tools/)${RESET}"
    local -a root_entries=()
    local ext f
    for ext in sh mjs py js; do
        for f in "$SRC"/*.$ext(N) "$SRC"/tools/*.$ext(N); do
            [[ -f "$f" ]] && root_entries+=("$f")
        done
    done
    local total_root=${#root_entries} idx_root=0
    local stem d last_r  # 루프 밖 선언
    for f in "${root_entries[@]}"; do
        ((idx_root++))
        stem="${${f:t}%.*}"; d=""; last_r=0
        [[ "$idx_root" == "$total_root" ]] && last_r=1
        d=$(_desc "$f")
        _row "$last_r" "│   " "$stem" "$d"
    done

    # 하위 섹션
    local skip_dirs=(tools memory memory-backup backup .git .claude webExporter Markdown2ID)
    local -a sections=()
    local dname skip sd
    for d in "$SRC"/*(N/); do
        dname="${d:t}"; skip=0
        for s in "${skip_dirs[@]}"; do [[ "$dname" == "$s" ]] && skip=1 && break; done
        [[ $skip == 1 ]] && continue
        [[ "$dname" == "PDF to"* ]] && continue
        sections+=("$d")
    done

    local total_sec=${#sections} idx_sec=0
    local is_last
    for d in "${sections[@]}"; do
        ((idx_sec++))
        dname="${d:t}"; is_last=0
        [[ "$idx_sec" == "$total_sec" ]] && is_last=1

        if [[ "$dname" == clouds ]]; then
            for sd in "$d"/*(N/); do
                _section "clouds/${sd:t}" "$sd" "$is_last"
            done
        else
            _section "$dname" "$d" "$is_last"
        fi
    done

    echo ""
    echo "${DIM}  tip: worker-ctl <워커> <함수>   예) worker-ctl sisoso sync-to-framer${RESET}"
    echo ""
}

_main
