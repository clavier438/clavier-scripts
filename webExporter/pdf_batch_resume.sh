#!/bin/bash
# ============================================================
# PDF 일괄 내보내기 - 재개 가능 버전 (bash 3 호환)
# LaunchAgent로 관리됨. 완료시 자동으로 LaunchAgent 제거.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/books"
URLS_FILE="$SCRIPT_DIR/pdf_export_urls.txt"
PROGRESS_FILE="$SCRIPT_DIR/pdf_export_progress.txt"
LOG_FILE="$SCRIPT_DIR/pdf_export_master.log"
EXPORT_SCRIPT="$SCRIPT_DIR/webSiteExporter.py"
PLIST_PATH="$HOME/Library/LaunchAgents/com.clavier.pdfexport.plist"
LABEL="com.clavier.pdfexport"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# ── 진행상황 초기화 ────────────────────────────────────────
touch "$PROGRESS_FILE"

TOTAL=0
[ -f "$URLS_FILE" ]    && TOTAL=$(grep -c . "$URLS_FILE" 2>/dev/null); TOTAL=${TOTAL:-0}
ALREADY_DONE=0
[ -f "$PROGRESS_FILE" ] && ALREADY_DONE=$(grep -c . "$PROGRESS_FILE" 2>/dev/null); ALREADY_DONE=${ALREADY_DONE:-0}
REMAINING=$((TOTAL - ALREADY_DONE))

log "=========================================="
log "PDF 일괄 내보내기 시작"
log "전체: ${TOTAL}개 / 완료: ${ALREADY_DONE}개 / 남은 작업: ${REMAINING}개"
log "출력: $OUTPUT_DIR"
log "=========================================="

# ── 각 URL 처리 ───────────────────────────────────────────
SUCCESS=0
FAIL=0

while IFS= read -r URL; do
    [ -z "$URL" ] && continue

    # 이미 완료된 항목 스킵 (progress 파일에서 정확히 일치하는 줄 검색)
    if grep -qxF "$URL" "$PROGRESS_FILE" 2>/dev/null; then
        continue
    fi

    log "처리 시작: $URL"

    if python3 "$EXPORT_SCRIPT" "$URL" -o "$OUTPUT_DIR" -m 5 -s 60 >> "$LOG_FILE" 2>&1; then
        echo "$URL" >> "$PROGRESS_FILE"
        SUCCESS=$((SUCCESS + 1))
        log "완료: $URL"
    else
        FAIL=$((FAIL + 1))
        log "실패: $URL"
    fi

done < "$URLS_FILE"

# ── 최종 결과 ─────────────────────────────────────────────
TOTAL_DONE=$(grep -c . "$PROGRESS_FILE" 2>/dev/null || echo 0)

log "=========================================="
log "모든 작업 완료!"
log "이번 실행 - 성공: ${SUCCESS} / 실패: ${FAIL}"
log "전체 진행 - ${TOTAL_DONE}/${TOTAL}개"
log "=========================================="

# ── LaunchAgent 자동 제거 ──────────────────────────────────
if [ "$TOTAL_DONE" -ge "$TOTAL" ]; then
    log "모든 URL 처리 완료. LaunchAgent 제거 중..."
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || \
        launchctl unload "$PLIST_PATH" 2>/dev/null
    rm -f "$PLIST_PATH"
    log "LaunchAgent 제거 완료. 작업 종료."
fi

exit 0
