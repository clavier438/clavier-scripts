#!/bin/bash
# syncScriptable.sh — Scriptable → Google Drive 실시간 동기화 데몬
# Usage: syncScriptable {start|stop|restart|status|sync|logs}

SOURCE="$HOME/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable"
GDRIVE_ROOT=$(find "$HOME/Library/CloudStorage" -maxdepth 1 -name "GoogleDrive-*" -type d 2>/dev/null | head -1)
DEST="$GDRIVE_ROOT/My Drive/scriptableSync"
PID_FILE="$HOME/.local/run/syncScriptable.pid"
LOG_FILE="$HOME/Library/Logs/syncScriptable.log"
FSWATCH='/opt/homebrew/bin/fswatch'

mkdir -p "$(dirname "$PID_FILE")"

do_sync() {
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] Syncing..." >> "$LOG_FILE"
    /opt/homebrew/bin/rsync -a --delete --ignore-errors \
        --exclude='*.icloud' \
        --exclude='.DS_Store' \
        --exclude='data/health/' \
        "$SOURCE/" "$DEST/" >> "$LOG_FILE" 2>&1
    local exit_code=$?
    if [ $exit_code -eq 0 ]; then
        echo "[$ts] Done." >> "$LOG_FILE"
    else
        echo "[$ts] rsync exited with code $exit_code" >> "$LOG_FILE"
    fi
}

start() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Already running (PID $pid)"
            return 1
        fi
        rm -f "$PID_FILE"
    fi

    echo "Starting Scriptable → Google Drive sync daemon..."
    echo "Source : $SOURCE"
    echo "Dest   : $DEST"

    do_sync

    (
        trap 'exit 0' TERM INT
        "$FSWATCH" -o -r "$SOURCE" \
            --exclude='\.icloud$' \
            --exclude='\.DS_Store$' \
        | while read -r _; do
            do_sync
        done
    ) &

    local pid=$!
    echo $pid > "$PID_FILE"
    echo "Started (PID $pid)"
    echo "Logs  : $LOG_FILE"
    echo ""
    echo "Tip: run '$(basename "$0") logs' to watch live"
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Not running (no PID file found)"
        return 1
    fi

    local pid
    pid=$(cat "$PID_FILE")

    if kill -0 "$pid" 2>/dev/null; then
        local pgid
        pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
        [ -n "$pgid" ] && kill -- -"$pgid" 2>/dev/null
        kill "$pid" 2>/dev/null
        echo "Stopped (PID $pid)"
    else
        echo "Process was not running — cleaning up stale PID file"
    fi

    rm -f "$PID_FILE"
}

status() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Running (PID $pid)"
            echo "Log: $LOG_FILE"
            return 0
        else
            echo "Not running (stale PID file, cleaning up)"
            rm -f "$PID_FILE"
        fi
    else
        echo "Not running"
    fi
    return 1
}

case "${1:-}" in
    start)   start ;;
    stop)    stop ;;
    restart) stop; sleep 1; start ;;
    status)  status ;;
    sync)
        echo "Running one-time sync..."
        do_sync
        echo "Done."
        ;;
    logs)
        [ -f "$LOG_FILE" ] && tail -f "$LOG_FILE" || echo "No log file yet: $LOG_FILE"
        ;;
    *)
        echo "Scriptable → Google Drive Sync Daemon"
        echo ""
        echo "Usage: $(basename "$0") <command>"
        echo ""
        echo "  start    — Initial sync + start file watcher daemon"
        echo "  stop     — Stop the daemon"
        echo "  restart  — Stop then start"
        echo "  status   — Check if daemon is running"
        echo "  sync     — One-time manual sync (no daemon)"
        echo "  logs     — Tail the sync log live"
        ;;
esac
