#!/bin/bash
# obsidianTagSync.sh — Obsidian #태그 → macOS Finder 태그 실시간 동기화 데몬
# @group watcher
# @type launchagent
# @label com.clavier.obsidian-tag-sync
# 동작:
#   1. 시작 시 vault 전체 .md 파일 초기 스캔
#   2. fswatch로 .md 파일 변경 감지 (이벤트 드리븐)
#   3. 파일 상위 40줄에서 #tag 패턴 추출 → macOS Finder 태그 적용
#
# Usage: obsidianTagSync {start|stop|restart|status|scan|logs}
# 의존: brew install fswatch tag

VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents"
PID_FILE="$HOME/.local/run/obsidianTagSync.pid"
LOG_FILE="$HOME/Library/Logs/obsidianTagSync.log"
FSWATCH='/opt/homebrew/bin/fswatch'
TAG='/opt/homebrew/bin/tag'

mkdir -p "$(dirname "$PID_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# ── 태그 추출 ────────────────────────────────────────────────────
# Obsidian 인라인 태그: #word (단, # 뒤에 숫자만 오는 건 제외, 공백 뒤 # 는 heading)
# 상위 40줄만 스캔 (파일 상단에 태그 집중됨)
extract_tags() {
    local file="$1"
    head -40 "$file" 2>/dev/null \
        | grep -oE '(^|[[:space:]])#[a-zA-Z가-힣][a-zA-Z0-9가-힣_/-]*' \
        | grep -oE '#[a-zA-Z가-힣][a-zA-Z0-9가-힣_/-]*' \
        | sed 's/^#//' \
        | sort -u
}

# ── macOS 태그 적용 ───────────────────────────────────────────────
apply_tags() {
    local file="$1"

    [[ "$file" != *.md ]]     && return
    [[ "$file" == *.icloud ]] && return
    [[ ! -f "$file" ]]        && return

    local tags
    tags=$(extract_tags "$file")

    if [ -z "$tags" ]; then
        return
    fi

    # tag CLI 형식: "tag1,tag2,tag3"
    local tag_csv
    tag_csv=$(printf '%s' "$tags" | tr '\n' ',' | sed 's/,$//')

    if "$TAG" --set "$tag_csv" "$file" 2>/dev/null; then
        log "적용: [${tag_csv}] ← $(basename "$file")"
    else
        log "실패: $(basename "$file") (태그: ${tag_csv})"
    fi
}

# ── 전체 볼트 초기 스캔 ───────────────────────────────────────────
initial_scan() {
    log "초기 스캔 시작..."
    local count=0
    while IFS= read -r -d '' file; do
        apply_tags "$file"
        ((count++)) || true
    done < <(find "$VAULT" -name "*.md" ! -name "*.icloud" -print0 2>/dev/null)
    log "초기 스캔 완료: ${count}개 파일 처리"
}

# ── 데몬 시작 ────────────────────────────────────────────────────
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

    if [ ! -x "$TAG" ]; then
        echo "Error: 'tag' CLI 없음. 설치: brew install tag"
        log "Error: tag CLI not found at $TAG"
        return 1
    fi

    if [ ! -x "$FSWATCH" ]; then
        echo "Error: fswatch 없음. 설치: brew install fswatch"
        log "Error: fswatch not found at $FSWATCH"
        return 1
    fi

    echo "Obsidian Tag Sync 시작..."
    log "=== 데몬 시작 ==="

    initial_scan

    (
        trap 'exit 0' TERM INT

        # fswatch: 변경된 파일 경로를 한 줄씩 출력 (-o 없이)
        "$FSWATCH" \
            --recursive \
            --latency 1.5 \
            --exclude '\.icloud$' \
            --exclude '\.DS_Store$' \
            --exclude '/\.obsidian/' \
            "$VAULT" \
        | while IFS= read -r changed_file; do
            apply_tags "$changed_file"
        done
    ) &

    local pid=$!
    echo $pid > "$PID_FILE"
    echo "Started (PID $pid)"
    echo "Vault : $VAULT"
    echo "Logs  : $LOG_FILE"
    echo ""
    echo "Tip: $(basename "$0") logs  — 실시간 로그 확인"
}

# ── 데몬 중지 ────────────────────────────────────────────────────
stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Not running (PID 파일 없음)"
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
        log "=== 데몬 중지 ==="
    else
        echo "프로세스 없음 — stale PID 파일 정리"
    fi

    rm -f "$PID_FILE"
}

# ── 상태 확인 ────────────────────────────────────────────────────
status() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Running (PID $pid)"
            echo "Log: $LOG_FILE"
            return 0
        else
            echo "Not running (stale PID, 정리 중)"
            rm -f "$PID_FILE"
        fi
    else
        echo "Not running"
    fi
    return 1
}

# ── 명령 디스패치 ─────────────────────────────────────────────────
case "${1:-}" in
    start)   start ;;
    stop)    stop ;;
    restart) stop; sleep 1; start ;;
    status)  status ;;
    scan)
        echo "수동 전체 스캔 실행..."
        initial_scan
        echo "완료."
        ;;
    logs)
        [ -f "$LOG_FILE" ] && tail -f "$LOG_FILE" || echo "로그 없음: $LOG_FILE"
        ;;
    *)
        echo "Obsidian → macOS Finder 태그 동기화 데몬"
        echo ""
        echo "Usage: $(basename "$0") <command>"
        echo ""
        echo "  start    — 초기 스캔 + fswatch 데몬 시작"
        echo "  stop     — 데몬 중지"
        echo "  restart  — 재시작"
        echo "  status   — 실행 상태 확인"
        echo "  scan     — 수동 전체 스캔 (데몬 없이 1회)"
        echo "  logs     — 실시간 로그 tail"
        ;;
esac
