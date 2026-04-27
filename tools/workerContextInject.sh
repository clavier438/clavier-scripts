#!/usr/bin/env bash
# workerContextInject.sh — Claude Code UserPromptSubmit hook
#
# 왜 존재하는가: 워커 관련 작업 시 ARCHITECTURE.md를 안 읽고 코드부터 수정하다가
# 설계 의도를 모른 채 수정하면 의도하지 않은 퇴행이 발생함 (MISSION 책무 8번).
# 사용자 프롬프트에 워커 키워드가 등장하면 시스템 레이어에서 강제 주입.
#
# 출력: hookSpecificOutput JSON (Claude Code UserPromptSubmit hook 규약)
# 키워드 미매칭 시: silent exit (컨텍스트 주입 없음)

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // ""')

# 워커 관련 키워드 매칭 (대소문자 무시)
if ! echo "$prompt" | grep -qiE "worker|워커|platform-workers|framer-sync|worker-ctl|refresh-schema|wrangler|control-tower|hotelAgency|sisoso.*sync|sync.*sisoso"; then
    exit 0
fi

ICLOUD="/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0"
ARCH_FRAMER_SYNC="$ICLOUD/code/projects/platform-workers/framer-sync/ARCHITECTURE.md"
ARCH_PLATFORM="$ICLOUD/code/projects/platform-workers/ARCHITECTURE.md"
SYS_ENV="$ICLOUD/code/projects/clavier-hq/SYSTEM_ENV.md"

read_file() {
    [ -f "$1" ] && cat "$1" || echo "(파일 없음: $1)"
}

combined=$(printf '# === [worker context auto-inject — 워커 키워드 감지] ===\n\n## platform-workers/framer-sync/ARCHITECTURE.md\n\n%s\n\n## platform-workers/ARCHITECTURE.md\n\n%s\n\n## clavier-hq/SYSTEM_ENV.md\n\n%s' \
  "$(read_file "$ARCH_FRAMER_SYNC")" \
  "$(read_file "$ARCH_PLATFORM")" \
  "$(read_file "$SYS_ENV")")

echo "{\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":$(echo "$combined" | jq -Rs .)}}"
