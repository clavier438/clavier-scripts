#!/usr/bin/env zsh
# scripts — eza 스타일 grid 명령어 카탈로그 (빠름, 색별, 자동 컬럼)

setopt nullglob

SRC="${HOME}/Library/Mobile Documents/com~apple~CloudDocs/0/scripts"
COLS="${COLUMNS:-$(tput cols 2>/dev/null || echo 100)}"

# 색감 (eza 차용)
B=$'\033[1m'; D=$'\033[2m'; R=$'\033[0m'
SH=$'\033[38;5;46m'       # .sh   bright green
MJS=$'\033[38;5;220m'     # .mjs  gold
PY=$'\033[38;5;39m'       # .py   cyan-blue
RB=$'\033[38;5;203m'      # .rb   coral
HEAD=$'\033[38;5;141m'    # 섹션 헤더 purple
TITLE=$'\033[1;38;5;33m'  # 타이틀 blue

color_for() {
    case "$1" in
        sh) print $SH ;;
        mjs|js) print $MJS ;;
        py) print $PY ;;
        rb) print $RB ;;
        *) print "" ;;
    esac
}

# 한 섹션 grid 렌더 — plain 폭으로 패딩, colored 로 출력
render_section() {
    local label="$1"; shift
    local -a paths=("$@")
    [[ ${#paths} -eq 0 ]] && return

    local -a plains=() colored=()
    local f stem ext c
    for f in "${paths[@]}"; do
        stem="${${f:t}%.*}"
        ext="${f:e}"
        c=$(color_for "$ext")
        plains+=("$stem")
        colored+=("${c}${stem}${R}")
    done

    local maxlen=0 i
    for ((i=1; i<=${#plains}; i++)); do
        (( ${#plains[i]} > maxlen )) && maxlen=${#plains[i]}
    done
    local cell=$((maxlen + 2))
    local ncols=$((COLS / cell))
    (( ncols < 1 )) && ncols=1

    print
    printf "${B}${HEAD}%s${R}  ${D}%d${R}\n" "$label" ${#plains}

    local col=0 fill
    for ((i=1; i<=${#plains}; i++)); do
        fill=$((cell - ${#plains[i]}))
        printf "%s%*s" "${colored[i]}" $fill ""
        ((col++))
        if (( col >= ncols )); then
            print
            col=0
        fi
    done
    (( col > 0 )) && print
}

# 메인 ────────────────────────────────────────────────
print
printf "${TITLE}clavier-scripts${R}  ${D}canonical: ${SRC/#$HOME/~}${R}\n"

# [scripts] = 루트 + tools/ (~/bin 에서 둘 다 flat 배포돼 사용자 관점에서 동일)
typeset -a TOP=()
for f in "$SRC"/*.{sh,mjs,py,js,rb}(N) "$SRC/tools"/*.{sh,mjs,py,js,rb}(N); do
    [[ -f "$f" ]] && TOP+=("$f")
done
render_section "scripts" "${TOP[@]}"

# 서브폴더 자동 감지 (installScripts.sh SKIP_DIRS 미러)
SKIP=(tools memory memory-backup backup .git .claude .wrangler webExporter Markdown2ID docs framer-components)

for d in "$SRC"/*(N/); do
    dn="${d:t}"
    [[ "$dn" == "PDF to"* ]] && continue
    skipped=0
    for s in "${SKIP[@]}"; do [[ "$dn" == "$s" ]] && skipped=1 && break; done
    (( skipped )) && continue

    if [[ "$dn" == "clouds" ]]; then
        for sd in "$d"/*(N/); do
            typeset -a items=()
            for f in "$sd"/*.{sh,mjs,py,js,rb}(N); do
                [[ -f "$f" ]] && items+=("$f")
            done
            render_section "clouds/${sd:t}" "${items[@]}"
        done
        continue
    fi

    typeset -a items=()
    for f in "$d"/*.{sh,mjs,py,js,rb}(N); do
        [[ -f "$f" ]] && items+=("$f")
    done
    render_section "$dn" "${items[@]}"
done

print
printf "${D}  tip: ${R}${B}<cmd>${R}${D} 만 쳐도 보통 usage 가 뜬다  •  source: ${R}${B}cat \$(which <cmd>)${R}\n"
print
