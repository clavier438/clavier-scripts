#!/usr/bin/env bash
# statusBriefing.sh — 터미널 세션 시작 시 데몬 상태 + 스크립트 목록 브리핑
# ~/.zshrc 에서 자동 호출됨 / 직접 실행: statusBriefing

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

    local status=""
    local color=""

    if [[ "$pid_file" != "-" && -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            status="running (PID $pid)"
            color="$GREEN"
        else
            status="dead (stale pid)"
            color="$RED"
        fi
    else
        local lc_out
        lc_out=$(launchctl list "$label" 2>/dev/null)
        if [[ $? -eq 0 ]]; then
            local pid
            pid=$(echo "$lc_out" | awk '/"PID"/{gsub(/[^0-9]/,"",$3); print $3}')
            if [[ -n "$pid" && "$pid" != "0" ]]; then
                status="running (PID $pid)"
                color="$GREEN"
            else
                status="loaded (idle)"
                color="$YELLOW"
            fi
        else
            status="not loaded"
            color="$RED"
        fi
    fi

    printf "  ${color}%-22s${RESET} %s\n" "$short" "$status"
}

# ── 데몬 확인 + 자동 재시작 (PID 기반 데몬용) ───────────────
ensure_daemon() {
    local short="$1"
    local pid_file="$2"
    local daemon_cmd="$HOME/bin/daemons/$short"

    local is_running=false
    if [[ -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            is_running=true
        fi
    fi

    if $is_running; then
        local pid
        pid=$(cat "$pid_file")
        printf "  ${GREEN}%-22s${RESET} running (PID $pid)\n" "$short"
    else
        printf "  ${RED}%-22s${RESET} dead → restarting...\n" "$short"
        rm -f "$pid_file"
        if [[ -x "$daemon_cmd" ]]; then
            "$daemon_cmd" start > /dev/null 2>&1
            sleep 0.5
            if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
                local new_pid
                new_pid=$(cat "$pid_file")
                printf "  ${GREEN}%-22s${RESET} started  (PID $new_pid)\n" "$short"
            else
                printf "  ${RED}%-22s${RESET} start failed\n" "$short"
            fi
        else
            printf "  ${RED}%-22s${RESET} daemon cmd not found: $daemon_cmd\n" "$short"
        fi
    fi
}

# ── 출력 ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}  ▌ 데몬 상태${RESET}"

echo ""
echo -e "  ${DIM}[ sync ]${RESET}"
ensure_daemon "syncObsidian"   "$HOME/.local/run/syncObsidian.pid"
ensure_daemon "syncScriptable" "$HOME/.local/run/syncScriptable.pid"

echo ""
echo -e "  ${DIM}[ watcher ]${RESET}"
check_daemon "com.clavier.watcherSync"        "watcherSync"        "-"
check_daemon "com.clavier.watcherScripts"     "watcherScripts"     "-"
check_daemon "com.clavier.watcherScreenshots" "watcherScreenshots" "-"

echo ""
echo -e "  ${DIM}[ worker ]${RESET}"
check_daemon "com.clavier.workerPdf" "workerPdf" "-"

echo ""
echo -e "  ${DIM}시작/중지: syncObsidian start|stop|status${RESET}"

"$SELF_DIR/scriptsList"
