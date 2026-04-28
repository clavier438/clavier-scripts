#!/bin/bash
# gitSync.sh — scripts 폴더 변경사항을 자동으로 git commit + push
# 트리거: LaunchAgent(com.clavier.watcherGitSync) 또는 직접 실행
# @group watcher
# @type launchagent
# @label com.clavier.watcherGitSync
#
# 의존: ANTHROPIC_API_KEY (Doppler clavier/prd — LaunchAgent plist이 doppler run으로 주입)
#       git remote origin (push 시)

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SELF_DIR")"   # daemons/ 의 부모 = scripts/
LOG_FILE="$HOME/Library/Logs/gitSync.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

# ── 변경사항 확인 ────────────────────────────────────────────
cd "$REPO_DIR" || { log "ERROR: repo dir not found: $REPO_DIR"; exit 1; }

if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
    log "변경사항 없음 — 종료"
    exit 0
fi

log "=== gitSync 시작 ==="

# ── 스테이징 ────────────────────────────────────────────────
git add -A
DIFF_STAT="$(git diff --cached --stat)"
DIFF_CONTENT="$(git diff --cached -- '*.sh' '*.py' '*.js' '*.jsx' '*.md' | head -300)"
CHANGED_FILES="$(git diff --cached --name-only)"

log "변경 파일:"
echo "$CHANGED_FILES" | while read -r f; do log "  $f"; done

# ── 커밋 메시지 생성 ────────────────────────────────────────
generate_message() {
    if [[ -z "$ANTHROPIC_API_KEY" ]]; then
        # fallback: diff stat 기반 단순 메시지
        local added modified deleted
        added=$(echo "$CHANGED_FILES" | git diff --cached --diff-filter=A --name-only | wc -l | tr -d ' ')
        modified=$(git diff --cached --diff-filter=M --name-only | wc -l | tr -d ' ')
        deleted=$(git diff --cached --diff-filter=D --name-only | wc -l | tr -d ' ')
        echo "update scripts: +${added} ~${modified} -${deleted} files"
        return
    fi

    local payload
    payload=$(jq -n \
        --arg diff_stat "$DIFF_STAT" \
        --arg diff_content "$DIFF_CONTENT" \
        --arg files "$CHANGED_FILES" \
        '{
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{
                role: "user",
                content: ("다음은 개인 자동화 스크립트 저장소의 git diff입니다.\n변경 파일:\n" + $files + "\n\n변경 요약:\n" + $diff_stat + "\n\n변경 내용(일부):\n" + $diff_content + "\n\n한 줄 커밋 메시지를 작성해주세요. 형식: \"type: 핵심 변경 내용 요약\" (type은 feat/fix/refactor/chore/docs 중 하나). 메시지만 출력, 설명 없이.")
            }]
        }')

    local response
    response=$(curl -s https://api.anthropic.com/v1/messages \
        -H "x-api-key: $ANTHROPIC_API_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -H "content-type: application/json" \
        -d "$payload" 2>/dev/null)

    local msg
    msg=$(echo "$response" | jq -r '.content[0].text // empty' 2>/dev/null)

    if [[ -z "$msg" ]]; then
        log "Claude API 응답 실패 — fallback 메시지 사용"
        echo "update: $(echo "$CHANGED_FILES" | head -3 | tr '\n' ' ')"
    else
        echo "$msg"
    fi
}

COMMIT_MSG="$(generate_message)"
log "커밋 메시지: $COMMIT_MSG"

# ── 커밋 ────────────────────────────────────────────────────
git commit -m "$COMMIT_MSG"
log "커밋 완료"

# ── Push (remote 있을 때만) ──────────────────────────────────
if git remote get-url origin &>/dev/null; then
    if git push origin main >> "$LOG_FILE" 2>&1; then
        log "push 완료"
    else
        log "push 실패 (로그 확인)"
    fi
else
    log "remote 없음 — push 생략"
fi

log "=== gitSync 완료 ==="
