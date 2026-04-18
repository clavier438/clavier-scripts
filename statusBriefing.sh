#!/usr/bin/env zsh
# statusBriefing.sh — 터미널 세션 시작 시 데몬 상태 + 스크립트 목록 브리핑
# ~/.zshrc 에서 자동 호출됨 / 직접 실행: statusBriefing

SELF_DIR="${0:A:h}"

BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
YELLOW='\033[1;33m'
RESET='\033[0m'

# ── 데몬 상태 체크 ───────────────────────────────────────────
check_daemon() {
    local label="$1"
    local short="$2"
    local pid_file="$3"   # 없으면 "-" 전달

    local _st="" _color="" _pid _lc_out

    if [[ "$pid_file" != "-" && -f "$pid_file" ]]; then
        _pid=$(cat "$pid_file")
        if kill -0 "$_pid" 2>/dev/null; then
            _st="running (PID $_pid)"; _color="$GREEN"
        else
            _st="dead (stale pid)";   _color="$RED"
        fi
    else
        _lc_out=$(launchctl list "$label" 2>/dev/null)
        if [[ $? -eq 0 ]]; then
            _pid=$(echo "$_lc_out" | awk '/"PID"/{gsub(/[^0-9]/,"",$3); print $3}')
            if [[ -n "$_pid" && "$_pid" != "0" ]]; then
                _st="running (PID $_pid)"; _color="$GREEN"
            else
                _st="loaded (idle)";       _color="$YELLOW"
            fi
        else
            _st="not loaded"; _color="$RED"
        fi
    fi

    printf "  ${_color}%-22s${RESET} %s\n" "$short" "$_st"
}

# ── 데몬 확인 + 자동 재시작 (PID 기반 데몬용) ───────────────
ensure_daemon() {
    local short="$1"
    local pid_file="$2"
    local daemon_cmd="$HOME/bin/daemons/$short"
    local _pid _new_pid

    local _running=false
    if [[ -f "$pid_file" ]]; then
        _pid=$(cat "$pid_file")
        kill -0 "$_pid" 2>/dev/null && _running=true
    fi

    if $_running; then
        printf "  ${GREEN}%-22s${RESET} running (PID $_pid)\n" "$short"
    else
        printf "  ${RED}%-22s${RESET} dead → restarting...\n" "$short"
        rm -f "$pid_file"
        if [[ -x "$daemon_cmd" ]]; then
            "$daemon_cmd" start > /dev/null 2>&1
            sleep 0.5
            if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
                _new_pid=$(cat "$pid_file")
                printf "  ${GREEN}%-22s${RESET} started  (PID $_new_pid)\n" "$short"
            else
                printf "  ${RED}%-22s${RESET} start failed\n" "$short"
            fi
        else
            printf "  ${RED}%-22s${RESET} daemon cmd not found: $daemon_cmd\n" "$short"
        fi
    fi
}

# ── 데몬 메타 파싱 함수 ──────────────────────────────────────
# 데몬 .sh 파일의 # @key value 주석을 읽어 값 추출
parse_meta() {
    local file="$1" key="$2"
    grep "^# @${key} " "$file" 2>/dev/null | head -1 | sed "s|^# @${key} ||"
}

# ── 출력 ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}  ▌ 데몬 상태${RESET}"

# daemons/*.sh의 @group 주석을 읽어 동적으로 그룹화 + 상태 표시
# 하드코딩 없음 — 데몬 추가/삭제/이름변경 시 자동 반영
declare -A _group_files
for _f in "$SELF_DIR/daemons"/*; do
    [[ -f "$_f" ]] || continue
    _g="$(parse_meta "$_f" "group")"
    [[ -z "$_g" ]] && _g="기타"
    _group_files[$_g]+="${_f}|"
done

for _group in "sync" "watcher" "worker" "기타"; do
    [[ -z "${_group_files[$_group]:-}" ]] && continue
    echo ""
    echo -e "  ${DIM}[ $_group ]${RESET}"

    IFS='|' read -rA _files <<< "${_group_files[$_group]:-}"
    for _f in "${_files[@]}"; do
        [[ -f "$_f" ]] || continue
        _name="$(basename "${_f%.*}")"
        _type="$(parse_meta "$_f" "type")"
        _restart="$(parse_meta "$_f" "restart")"

        if [[ "$_type" == "pid" ]]; then
            _pid_path="$(parse_meta "$_f" "pid")"
            _pid_file="${_pid_path/#\~/$HOME}"
            if [[ "$_restart" == "true" ]]; then
                ensure_daemon "$_name" "$_pid_file"
            else
                check_daemon "-" "$_name" "$_pid_file"
            fi
        else
            _label="$(parse_meta "$_f" "label")"
            check_daemon "${_label:-com.clavier.$_name}" "$_name" "-"
        fi
    done
done

echo ""
echo -e "  ${DIM}시작/중지: syncObsidian start|stop|status${RESET}"

# ── 클라우드 / 원격 서버 상태 (동적 — clouds/*/server.conf 기반) ──
# 새 클라우드 서비스 추가 시 server.conf만 만들면 자동으로 여기 표시됨
echo ""
echo -e "${BOLD}${CYAN}  ▌ 연결 가능한 서버${RESET}"
echo ""

CLOUDS_DIR="$SELF_DIR/clouds"
found_any=false

for conf in "$CLOUDS_DIR"/*/server.conf; do
    [[ -f "$conf" ]] || continue
    found_any=true

    # server.conf에서 변수 로드 (LABEL, HOST, PORT)
    unset LABEL HOST PORT
    source "$conf"

    # 해당 서비스 폴더의 스크립트 이름들을 동적으로 수집
    svc_dir="$(dirname "$conf")"
    scripts=()
    for f in "$svc_dir"/*.sh; do
        [[ -f "$f" ]] && scripts+=("$(basename "${f%.*}")")
    done
    script_list="${scripts[*]}"           # 예: "ociIn"
    script_hint="→ ${script_list// / | }"  # 예: "→ ociIn"

    # 포트 체크 (2초 타임아웃)
    if nc -z -w 2 "${HOST}" "${PORT:-22}" 2>/dev/null; then
        printf "  ${GREEN}%-20s${RESET} %-20s %s\n" \
            "${LABEL}" "${HOST}:${PORT:-22}" "$script_hint"
    else
        printf "  ${RED}%-20s${RESET} %-20s %s\n" \
            "${LABEL}" "${HOST}:${PORT:-22}" "(응답 없음) $script_hint"
    fi
done

if ! $found_any; then
    echo -e "  ${DIM}등록된 서버 없음 (clouds/*/server.conf 추가 시 자동 표시)${RESET}"
fi

echo ""
echo -e "  ${DIM}연결: 스크립트명 직접 실행 (예: ociIn)${RESET}"

# scriptsList: 설치된 버전(~/bin) 우선, 없으면 소스에서 직접 실행
if [[ -x "$HOME/bin/scriptsList" ]]; then
    "$HOME/bin/scriptsList"
else
    zsh "$SELF_DIR/scriptsList.sh"
fi
