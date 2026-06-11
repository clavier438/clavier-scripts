#!/usr/bin/env bash
# door: system    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
# scripts — 기능적 진입점 브리핑. 진입점 여부의 근거는 *코드 자신*(실행 입구)이다.
#
#   scripts          # repo 전체의 기능적 진입점을 섹션별 + 설명 (브리핑)
#   scripts --all    # 루트+tools 의 모든 스크립트 grid (유지보수용 — 모듈 포함 전수)
#   scripts --gaps   # 진입점인데 ~/bin 명령으로 안 깔리는 것 (= 도달 누락 감사)
#
# 왜 이 구조인가 (근거를 코드 자신에 둔다 — 2026-06-11):
#   "이 파일이 진입점인가" 는 파일 안에 이미 있는 사실이다 — __main__ / argparse /
#   process.argv 같은 *실행 입구*를 가졌는가. 그걸 손으로 `# door:` 에 다시 적어 두고
#   그 사본을 쿼리하면, 사본을 깜빡할 때 조용히 빠진다(예전 모델의 한계 — webSiteExporter
#   가 그렇게 누락됐다). 그래서 포착을 파일 내용 스캔으로 되돌린다.
#   판별 규칙은 tools/lib/entryPoints.sh 단일 모듈 — scripts·--gaps·미래 도구가 같이 참조.
#   규칙을 바꿀 일이 생기면 그 한 곳만 고치면 모든 참조 도구가 따라온다(inline 재구현 금지).
#
#   `# door: <섹션>` 은 이제 *선택* — 있으면 섹션 라벨을 덮어쓰고, 없으면 폴더에서 derive.
#   빠뜨려도 진입점은 무조건 잡힌다(섹션만 폴더 기본값). 설명은 첫 em-dash(—) 줄(co-located).
#
# bash 로 작성(콜로니 .sh 컨벤션 — installScripts 래퍼가 .sh 를 bash 로 exec). macOS bash 3.2 호환.

export LC_ALL="${LC_ALL:-en_US.UTF-8}"   # ${#str} 가 바이트 아닌 문자수를 세도록
shopt -s nullglob

. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/freshness.sh"
. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/repoPaths.sh"
. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/entryPoints.sh"   # 진입점 판별 SSOT

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

# ── 섹션 결정: door 선언 있으면 그것(선택적 override), 없으면 폴더에서 derive ──
# door 는 이제 *섹션 라벨 덮어쓰기*일 뿐 — 포착(보일지 여부)은 entryPoints.sh 가 결정한다.
section_of() {
    local f="$1" sec rel dir
    sec="$(door_section "$f")"
    if [ -n "$sec" ]; then printf '%s' "$sec"; return; fi
    rel="${f#"$SRC"/}"
    case "$rel" in
        */*) dir="${rel%/*}"
             case "$dir" in
                 clouds/*/*) dir="${dir#clouds/}"; printf 'clouds/%s' "${dir%%/*}" ;;
                 clouds/*)   printf '%s' "$dir" ;;
                 */*)        printf '%s' "${dir%%/*}" ;;
                 *)          printf '%s' "$dir" ;;
             esac ;;
        *)   printf 'root' ;;
    esac
}

# ── 기본 모드: repo 전체의 기능적 진입점 브리핑 (근거 = entryPoints.sh) ────────
print_entrypoints() {
    printf '\n%s\n' "${TITLE}clavier-scripts${R}  ${D}기능적 진입점 브리핑 (근거 = 코드의 실행 입구 — tools/lib/entryPoints.sh)${R}"

    local rows=() f sec name
    while IFS= read -r f; do
        sec="$(section_of "$f")"
        name="${f##*/}"; name="${name%.*}"
        rows+=("$sec	$name	$f")
    done < <(ep_scan "$SRC")

    if [ ${#rows[@]} -eq 0 ]; then
        printf '%s\n\n' "${D}  진입점 0 (?) — entryPoints.sh 점검 필요${R}"
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

    printf '\n%s\n\n' "${D}  tip: ${R}${B}<cmd> --help${R}${D} 로 상세  •  포착 = 코드의 실행 입구(자동)  •  섹션 덮어쓰기 = ${R}${B}# door: <섹션>${R}${D}  •  도달 감사 = ${R}${B}scripts --gaps${R}${D}  •  전체 = ${R}${B}scripts --all${R}"
}

# ── --gaps: 기능적 진입점인데 ~/bin 명령으로 안 깔리는 것 (도달 누락 감사) ────
# 브리핑(기본 모드)은 이제 모든 진입점을 잡으므로 "안 보임" gap 은 없다. 남는 진짜 gap =
# 진입점이지만 사용자가 이름만 쳐서 못 부르는 것(installScripts SKIP 폴더 거주). 각각:
#   · 다른 스크립트가 부르면  → 래퍼 경유(정상, 의도된 모듈)
#   · 아무도 안 부르면        → 고립(도달 경로 0 — 진짜 문제)
# installScripts 의 SKIP_DIRS 를 *직접 읽는다* (사본 X — 그 파일이 배포의 SSOT).
print_gaps() {
    printf '\n%s\n' "${TITLE}scripts --gaps${R}  ${D}기능적 진입점인데 ~/bin 명령으로 안 깔리는 것 (도달 = 래퍼/수동만)${R}"
    local skip
    skip=" $(grep -m1 '^SKIP_DIRS=' "$SRC/installScripts.sh" 2>/dev/null | sed -E 's/^SKIP_DIRS=\(//; s/\).*$//; s/"//g') "
    local f rel top base callers hit=0
    while IFS= read -r f; do
        rel="${f#"$SRC"/}"
        case "$rel" in */*) top="${rel%%/*}" ;; *) top="root" ;; esac
        [ "$top" = "tools" ] && continue                       # tools 는 SKIP 목록에 있어도 ~/bin 평면 배포됨
        case "$skip" in *" $top "*) ;; *) continue;; esac      # 배포되는 폴더면 ~/bin 명령 있음 → gap 아님
        base="${f##*/}"
        callers="$(grep -rlF "$base" "$SRC" --include='*.sh' --include='*.py' --include='*.mjs' --include='*.js' 2>/dev/null | grep -vxF "$f" | head -1)"
        if [ -n "$callers" ]; then
            printf "  ${NAME}%s${R} ${D}— ~/bin 명령 아님, 래퍼 경유: %s${R}\n" "$base" "${callers#"$SRC"/}"
        else
            printf "  ${WARN}%s${R} ${D}— ~/bin 명령도 아니고 아무도 안 부름 = 고립(도달 경로 0)${R}\n" "$base"
        fi
        hit=1
    done < <(ep_scan "$SRC")
    [ $hit -eq 0 ] && printf '%s\n' "${D}  없음 — 모든 진입점이 ~/bin 명령으로 도달 가능 ✅${R}"
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
    *)         print_entrypoints ;;
esac
