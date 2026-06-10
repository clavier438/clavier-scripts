#!/usr/bin/env bash
# door: system    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
# scripts — 진입점(front door) 브리핑. 각 스크립트가 자기 헤더에 자기를 선언한다.
#
#   scripts          # door: 선언된 진입점만 섹션별 + 설명 (브리핑)
#   scripts --all    # 루트+tools 의 모든 스크립트 grid (유지보수용 — 모듈 포함 전수)
#   scripts --gaps   # 진입점처럼 보이나 door: 선언 빠진 후보 (= 브리핑 누락 감사)
#
# 왜 이 구조인가 (SvelteKit 정신 — 저장=등록):
#   front door 여부·섹션은 *스크립트 자신의 헤더 한 줄* `# door: <섹션>` 이 SSOT 다.
#   예전엔 cli/<맥락>/ 심링크 트리가 별도로 있었다 — "스크립트 추가" 와 "cli 등록" 이
#   두 행위라 stale 이 필연이었다(img·lut·wt 가 자주 빠짐). 선언을 스크립트 안으로
#   옮겨 *저장하는 행위 자체가 등록* 이 되게 했다. 별도 트리·manifest·생성물 = 0.
#   설명은 헤더의 첫 em-dash(—) 줄을 그대로 읽는다(co-located). drift 할 두 번째 store 가 없다.
#
#   새 진입점 = 헤더에 `# door: <섹션>` (또는 // / *) 한 줄. 끝. (scripts 가 자동 발견)
#
# bash 로 작성(콜로니 .sh 컨벤션 — installScripts 래퍼가 .sh 를 bash 로 exec). macOS bash 3.2 호환.

export LC_ALL="${LC_ALL:-en_US.UTF-8}"   # ${#str} 가 바이트 아닌 문자수를 세도록
shopt -s nullglob

. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/freshness.sh"
. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/repoPaths.sh"

SRC="$CLAVIER_SCRIPTS"
COLS="${COLUMNS:-$(tput cols 2>/dev/null || echo 100)}"

B=$'\033[1m'; D=$'\033[2m'; R=$'\033[0m'
NAME=$'\033[1;38;5;39m'    # 명령 이름
HEAD=$'\033[38;5;141m'     # 섹션 헤더
TITLE=$'\033[1;38;5;33m'
WARN=$'\033[38;5;214m'
SH=$'\033[38;5;46m'; MJS=$'\033[38;5;220m'; PY=$'\033[38;5;39m'; RB=$'\033[38;5;203m'

# ── door: 자기선언 추출 (SSOT) ────────────────────────────────────────────
# 첫 40줄에서 `door: <섹션>` 한 줄을 찾아 섹션만 반환. #, //, * 어느 주석 leader 든.
# 없으면 빈 문자열 = 진입점 아님(내부 모듈/라이브러리).
door_section() {
    sed -n '1,40p' "$1" 2>/dev/null \
        | grep -m1 -iE '^[[:space:]]*(#|//|\*)+[[:space:]]*door:[[:space:]]*[A-Za-z0-9_-]' \
        | sed -E 's/.*[Dd]oor:[[:space:]]*([A-Za-z0-9_-]+).*/\1/'
}

# ── 헤더 한 줄에서 설명 추출 ──────────────────────────────────────────────
# 첫 em-dash(—) 줄을 찾아 주석 leader(#, //, *, /**)·이름 부분을 벗기고 뒤만 반환.
# (door: 줄엔 — 가 없으므로 자동으로 건너뛰고 실제 제목/설명 줄을 잡는다.)
desc_of() {
    local line after
    line="$(grep -m1 -- '—' "$1" 2>/dev/null)"
    [ -z "$line" ] && return
    line="${line#"${line%%[![:space:]]*}"}"          # ltrim
    line="${line#/\*\*}"; line="${line#\#}"; line="${line#//}"; line="${line#\*}"
    line="${line#"${line%%[![:space:]]*}"}"          # ltrim
    after="${line#*—}"                               # 첫 em-dash 뒤
    after="${after#"${after%%[![:space:]]*}"}"       # ltrim
    printf '%s' "$after"
}

# 스캔 대상 = 루트 + tools 의 실행 스크립트 (lib 제외는 door: 부재로 자연 배제).
scan_files() {
    local f
    for f in "$SRC"/*.sh "$SRC"/*.mjs "$SRC"/*.py "$SRC"/*.js "$SRC"/*.rb \
             "$SRC"/tools/*.sh "$SRC"/tools/*.mjs "$SRC"/tools/*.py "$SRC"/tools/*.js "$SRC"/tools/*.rb; do
        [ -f "$f" ] && printf '%s\n' "$f"
    done
}

# ── 기본 모드: door: 선언된 진입점 브리핑 ─────────────────────────────────
print_frontdoors() {
    printf '\n%s\n' "${TITLE}clavier-scripts${R}  ${D}진입점 브리핑 (front doors — 각 스크립트가 # door: 로 자기선언)${R}"

    local rows=() f sec name
    while IFS= read -r f; do
        sec="$(door_section "$f")"
        [ -z "$sec" ] && continue
        name="${f##*/}"; name="${name%.*}"
        rows+=("$sec	$name	$f")
    done < <(scan_files)

    if [ ${#rows[@]} -eq 0 ]; then
        printf '%s\n\n' "${D}  선언된 진입점 없음 — 헤더에 # door: <섹션> 추가. (scripts --all 로 전체)${R}"
        return
    fi

    local maxlen=0 r n
    for r in "${rows[@]}"; do n="${r#*	}"; n="${n%%	*}"; [ ${#n} -gt $maxlen ] && maxlen=${#n}; done
    local namecol=$((maxlen + 2))
    local descw=$((COLS - namecol - 4)); [ $descw -lt 20 ] && descw=20

    local prev="" sec name file desc
    while IFS=$'\t' read -r sec name file; do
        if [ "$sec" != "$prev" ]; then printf '\n%s\n' "${HEAD}${sec}${R}"; prev="$sec"; fi
        desc="$(desc_of "$file")"
        [ ${#desc} -gt $descw ] && desc="${desc:0:$descw}…"
        printf "  ${NAME}%-${namecol}s${R} ${D}%s${R}\n" "$name" "$desc"
    done < <(printf '%s\n' "${rows[@]}" | LC_ALL=C sort)

    printf '\n%s\n\n' "${D}  tip: ${R}${B}<cmd> --help${R}${D} 로 상세  •  새 진입점 = 헤더에 ${R}${B}# door: <섹션>${R}${D} 한 줄  •  누락 감사 = ${R}${B}scripts --gaps${R}${D}  •  전체 = ${R}${B}scripts --all${R}"
}

# ── --gaps: 진입점처럼 보이나 door: 선언이 빠진 후보 (브리핑 누락 감사) ────
# 정의(hooks/pre-commit (5) 와 동일): main 진입점 + verb 라우터인데 door: 없음.
# 내부 모듈(다른 tools 가 파일명으로 호출)·라이브러리는 제외.
print_gaps() {
    printf '\n%s\n' "${TITLE}scripts --gaps${R}  ${D}진입점 같은데 # door: 선언이 빠진 후보${R}"
    local f base others hit=0
    for f in "$SRC"/tools/*.sh "$SRC"/tools/*.mjs "$SRC"/tools/*.py; do
        [ -f "$f" ] || continue
        case "$f" in */lib/*) continue;; esac
        [ -n "$(door_section "$f")" ] && continue                       # 이미 선언됨
        grep -qE '__main__|^main\b|function main\b|def main\b' "$f" || continue   # 실행 진입점
        grep -qE 'table[[:space:]]*=[[:space:]]*\{|choices=|add_parser|verb|case .* in' "$f" || continue  # verb 라우터
        base="$(basename "$f")"
        others="$(grep -rlF "$base" "$SRC"/tools/ --include='*.py' --include='*.mjs' --include='*.sh' 2>/dev/null | grep -vxF "$f")"
        [ -n "$others" ] && continue                                    # 내부 모듈(위임받는 쪽)
        printf "  ${WARN}%s${R} ${D}— 헤더에 # door: <섹션> 한 줄이면 브리핑에 뜸${R}\n" "$base"
        hit=1
    done
    [ $hit -eq 0 ] && printf '%s\n' "${D}  없음 — 모든 진입점 후보가 선언돼 있음 ✅${R}"
    printf '\n'
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
    printf '\n%s\n\n' "${D}  tip: ${R}${B}<cmd>${R}${D} 만 쳐도 보통 usage  •  진입점 브리핑만 = ${R}${B}scripts${R}"
}

case "${1:-}" in
    --all|-a)  print_all ;;
    --gaps|-g) print_gaps ;;
    *)         print_frontdoors ;;
esac
