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

# Tier 3 routines 등록 대기 마커 — setup.sh Step 9 가 박음 (포맷 후 한 번)
ROUTINES_PENDING="$HOME/.clavier/routines-pending"
if [ -f "$ROUTINES_PENDING" ]; then
    combined="$combined

# === ⚠️ Tier 3 routines 등록 대기 (포맷 후 1회) ===

마커 발견: \`~/.clavier/routines-pending\` (setup.sh Step 9 가 박음).

**행동**: 다른 작업 시작 전에
1. \`mcp__scheduled-tasks__list_scheduled_tasks\` 호출 — 현재 등록 현황 확인.
2. 5 routines (closer/ray-dalio/sentinel/engineer/architect) 모두 등록 안돼있으면 사용자에 \"/registerRoutines 한 번 실행하면 5 routines 일괄 등록\" 권유.
3. 사용자 yes 시 → /registerRoutines slash command 실행 (~/.claude/commands/registerRoutines.md). 마커는 그 명령이 삭제.

이미 모두 등록돼있으면 마커만 조용히 삭제 (\`rm ~/.clavier/routines-pending\`)."
fi

echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$(echo "$combined" | jq -Rs .)}}"
