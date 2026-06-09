#!/usr/bin/env bash
# scripts — 맥락별 front door 카탈로그 (위치=의미, SvelteKit routes/ 정신)
#
#   scripts          cli/<맥락>/ 트리에 놓인 *통합 진입점*만 맥락별로 + 설명과 함께
#   scripts --all    루트+tools 의 모든 스크립트 grid (유지보수용 — 모듈 포함 전수)
#
# 왜 cli/ 인가: front door 여부·맥락은 *파일을 어느 cli 폴더에 두느냐* 하나로 결정된다.
#   마커도 manifest 도 없음 — 추가/삭제/재분류 = 위치만 바꾸면 카탈로그 자동 반영(drift 0).
#   설명은 각 스크립트가 자기 헤더에 들고 있어(co-located) 런타임에 읽는다. cli/README.md 참조.
#
# bash 로 작성(콜로니 .sh 컨벤션 — installScripts 래퍼가 .sh 를 bash 로 exec).

export LC_ALL="${LC_ALL:-en_US.UTF-8}"   # ${#str} 가 바이트 아닌 문자수를 세도록
shopt -s nullglob

. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/freshness.sh"
. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/repoPaths.sh"

SRC="$CLAVIER_SCRIPTS"
CLI="$SRC/cli"
COLS="${COLUMNS:-$(tput cols 2>/dev/null || echo 100)}"

B=$'\033[1m'; D=$'\033[2m'; R=$'\033[0m'
NAME=$'\033[1;38;5;39m'    # 명령 이름
HEAD=$'\033[38;5;141m'     # 맥락 헤더
TITLE=$'\033[1;38;5;33m'
SH=$'\033[38;5;46m'; MJS=$'\033[38;5;220m'; PY=$'\033[38;5;39m'; RB=$'\033[38;5;203m'

# ── 심링크/파일을 실제 경로로 해소 (macOS readlink -f 없이) ────────────────
resolve() {
    local f="$1" t
    if [ -L "$f" ]; then
        t="$(readlink "$f")"
        case "$t" in
            /*) printf '%s' "$t" ;;
            *)  printf '%s' "$(cd "$(dirname "$f")" && cd "$(dirname "$t")" && pwd)/$(basename "$t")" ;;
        esac
    else
        printf '%s' "$f"
    fi
}

# ── 헤더 한 줄에서 설명 추출 ──────────────────────────────────────────────
# 첫 em-dash(—) 줄을 찾아 주석 leader(#, //, *, /**)·이름 부분을 벗기고 뒤만 반환.
desc_of() {
    local real line after
    real="$(resolve "$1")"
    line="$(grep -m1 -- '—' "$real" 2>/dev/null)"
    [ -z "$line" ] && return
    line="${line#"${line%%[![:space:]]*}"}"          # ltrim
    line="${line#/\*\*}"; line="${line#\#}"; line="${line#//}"; line="${line#\*}"
    line="${line#"${line%%[![:space:]]*}"}"          # ltrim
    after="${line#*—}"                               # 첫 em-dash 뒤
    after="${after#"${after%%[![:space:]]*}"}"       # ltrim
    printf '%s' "$after"
}

# ── 기본 모드: cli/ 맥락별 front door ─────────────────────────────────────
print_frontdoors() {
    printf '\n%s\n' "${TITLE}clavier-scripts${R}  ${D}맥락별 통합 진입점 (front doors)${R}"
    if [ ! -d "$CLI" ]; then
        printf '%s\n\n' "${D}  cli/ 없음 — front door 미등록. (scripts --all 로 전체 보기)${R}"
        return
    fi

    local maxlen=0 f n
    for f in "$CLI"/*/*; do n="${f##*/}"; [ ${#n} -gt $maxlen ] && maxlen=${#n}; done
    local namecol=$((maxlen + 2))
    local descw=$((COLS - namecol - 4)); [ $descw -lt 20 ] && descw=20

    local ctxdir ctx desc
    for ctxdir in "$CLI"/*/; do
        ctx="$(basename "$ctxdir")"
        local entries=("$ctxdir"*)
        [ ${#entries[@]} -eq 0 ] && continue
        printf '\n%s\n' "${HEAD}${ctx}${R}"
        for f in "${entries[@]}"; do
            [ -e "$f" ] || continue
            n="${f##*/}"
            desc="$(desc_of "$f")"
            [ ${#desc} -gt $descw ] && desc="${desc:0:$descw}…"
            printf "  ${NAME}%-${namecol}s${R} ${D}%s${R}\n" "$n" "$desc"
        done
    done
    printf '\n%s\n\n' "${D}  tip: ${R}${B}<cmd> --help${R}${D} 로 상세  •  새 front door = ${R}${B}cli/<맥락>/${R}${D} 에 심링크/파일 하나  •  전체 모듈 = ${R}${B}scripts --all${R}"
}

# ── --all 모드: 루트+tools 전체 grid (유지보수용) ─────────────────────────
color_for() { case "$1" in sh) printf '%s' "$SH";; mjs|js) printf '%s' "$MJS";; py) printf '%s' "$PY";; rb) printf '%s' "$RB";; *) printf '';; esac; }

render_grid() {
    local label="$1"; shift
    local paths=("$@"); [ ${#paths[@]} -eq 0 ] && return
    local stems=() colored=() f stem ext c maxlen=0 i
    for f in "${paths[@]}"; do
        stem="${f##*/}"; stem="${stem%.*}"; ext="${f##*.}"
        c="$(color_for "$ext")"
        stems+=("$stem"); colored+=("${c}${stem}${R}")
        [ ${#stem} -gt $maxlen ] && maxlen=${#stem}
    done
    local cell=$((maxlen + 2)) ncols=$((COLS / (maxlen + 2))); [ $ncols -lt 1 ] && ncols=1
    printf '\n%s  %s\n' "${B}${HEAD}${label}${R}" "${D}${#stems[@]}${R}"
    local col=0 fill
    for ((i=0; i<${#stems[@]}; i++)); do
        fill=$((cell - ${#stems[i]}))
        printf '%s%*s' "${colored[i]}" $fill ""
        col=$((col+1)); [ $col -ge $ncols ] && { printf '\n'; col=0; }
    done
    [ $col -gt 0 ] && printf '\n'
}

print_all() {
    printf '\n%s\n' "${TITLE}clavier-scripts${R}  ${D}전체 모듈 — canonical: ${SRC/#$HOME/\~}${R}"
    local TOP=() f
    for f in "$SRC"/*.sh "$SRC"/*.mjs "$SRC"/*.py "$SRC"/*.js "$SRC"/*.rb \
             "$SRC"/tools/*.sh "$SRC"/tools/*.mjs "$SRC"/tools/*.py "$SRC"/tools/*.js "$SRC"/tools/*.rb; do
        [ -f "$f" ] && TOP+=("$f")
    done
    render_grid "scripts" "${TOP[@]}"

    local SKIP=" tools memory backup .git .claude .wrangler webExporter Markdown2ID docs framer-components cli "
    local d dn sd
    for d in "$SRC"/*/; do
        dn="$(basename "$d")"
        case "$dn" in "PDF to"*) continue;; esac
        case "$SKIP" in *" $dn "*) continue;; esac
        if [ "$dn" = "clouds" ]; then
            for sd in "$d"*/; do
                local items=(); for f in "$sd"*.sh "$sd"*.mjs "$sd"*.py "$sd"*.js "$sd"*.rb; do [ -f "$f" ] && items+=("$f"); done
                render_grid "clouds/$(basename "$sd")" "${items[@]}"
            done
            continue
        fi
        local items=(); for f in "$d"*.sh "$d"*.mjs "$d"*.py "$d"*.js "$d"*.rb; do [ -f "$f" ] && items+=("$f"); done
        render_grid "$dn" "${items[@]}"
    done
    printf '\n%s\n\n' "${D}  tip: ${R}${B}<cmd>${R}${D} 만 쳐도 보통 usage  •  맥락별 진입점만 = ${R}${B}scripts${R}"
}

case "${1:-}" in
    --all|-a) print_all ;;
    *)        print_frontdoors ;;
esac
