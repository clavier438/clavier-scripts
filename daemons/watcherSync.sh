#!/bin/bash
# watcherSync.sh — sync 데몬(syncObsidian, syncScriptable) 상태 감시 및 자동 재시작
# LaunchAgent(com.clavier.watcherSync)가 1시간마다 실행

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$HOME/Library/Logs/watcherSync.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

check_and_start() {
    local name="$1"
    local script="$SELF_DIR/$name"
    local pid_file="$HOME/.local/run/${name}.pid"

    if [ -f "$pid_file" ]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log "$name: 실행 중 (PID $pid) — 정상"
            return 0
        else
            log "$name: PID 파일 있으나 프로세스 없음 — 재시작"
            rm -f "$pid_file"
        fi
    else
        log "$name: 꺼진 상태 감지 — 시작"
    fi

    bash "$script" start >> "$LOG_FILE" 2>&1
    log "$name: start 명령 실행 완료"
}

log "=== Watchdog 실행 ==="
check_and_start "syncObsidian"
check_and_start "syncScriptable"
check_and_start "obsidianTagSync"
log "=== Watchdog 완료 ==="
