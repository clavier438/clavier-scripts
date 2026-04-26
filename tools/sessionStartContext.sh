#!/usr/bin/env bash
# sessionStartContext.sh — Claude Code SessionStart hook용 컨텍스트 자동 주입
#
# 왜 존재하는가: CLAUDE.md만으로는 모델이 "clavier-hq 먼저 읽기" 지침을
# 가끔 흘끔만 보고 작업으로 뛰어드는 경우가 있음. 시스템 레이어에서
# 핵심 문서들을 컨텍스트에 강제 주입하면 모델이 무시할 수 없게 됨.
#
# 출력: hookSpecificOutput JSON (Claude Code SessionStart hook 규약)

ICLOUD="/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0"
HQ="$ICLOUD/code/projects/clavier-hq"

# clavier-hq 최신 상태로 업데이트 (네트워크 실패해도 진행)
if [ -d "$HQ/.git" ]; then
    git -C "$HQ" pull --quiet 2>/dev/null || true
fi

read_file() {
    if [ -f "$1" ]; then
        cat "$1"
    else
        echo "(파일 없음: $1)"
    fi
}

combined=$(printf '# === clavier-hq/MISSION.md (방향) ===\n%s\n\n# === clavier-hq/STATUS.md (현재 상태) ===\n%s\n\n# === clavier-hq/QUEUE.md (지금 할 일) ===\n%s' \
  "$(read_file "$HQ/MISSION.md")" \
  "$(read_file "$HQ/STATUS.md")" \
  "$(read_file "$HQ/QUEUE.md")")

echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$(echo "$combined" | jq -Rs .)}}"
