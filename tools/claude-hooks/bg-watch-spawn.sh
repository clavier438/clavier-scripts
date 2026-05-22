#!/bin/bash
# Claude Code PreToolUse hook — 백그라운드 Bash 호출 시 "주기적확인요망" 동반 task enforce
#
# 왜:
#   Claude 의 task-notification 시스템은 Claude 가 직접 호출한 `Bash(run_in_background=true)`
#   작업에만 발화 → 자동 다음-턴 트리거. Hook 외부 spawn (osascript 알림 등) 은 그 시스템
#   외부라 Claude 가 자동 인식 안 함.
#   해결: hook 이 Bash+bg 호출을 *enforce* 해서, Claude 가 어쩔 수 없이 동반 "주기적확인요망"
#   sleep task 도 같이 등록하게 만든다. 그 sleep task 가 ${DELAY_SEC}초 후 정상 완료되면서
#   task-notification 자동 발화 → Claude 다음 턴 강제 트리거.
#
# 동작 흐름:
#   1. Bash+bg 호출 감지 (PreToolUse)
#   2. description 에 "주기적확인요망" 포함 → marker 파일 touch + 통과 (이게 동반 task 본체)
#   3. description 에 없으면 marker 파일 확인:
#      - marker 없거나 ${DELAY_SEC}초 이상 expired → 차단 (Claude 한테 동반 task 먼저 등록 안내)
#      - marker 살아있음 (sleep task 가 진행 중) → 통과
#
# 회피 불가 근거:
#   - Hook 차단은 명령 자체를 막음. Claude 가 약속을 어겨도 차단됨 → 다음 응답에 두 호출 같이.
#   - 동반 sleep task 는 Claude Code 의 background-task system 에 정식 등록됨 → 끝날 때
#     task-notification 발화는 시스템 보장 (Claude 자유의지 무관).
#   - macOS sleep 모드는 sleep 명령을 일시정지. PC 깨어나면 카운터 이어감.

set -u

# === Config ===
DELAY_SEC="${WEBEXP_BG_WATCH_SEC:-1200}"        # 기본 20분
MARKER_FILE="${WEBEXP_BG_WATCH_MARKER:-/tmp/claude-periodic-active}"
LOG_DIR="${HOME}/.claude-bg-watch"
mkdir -p "$LOG_DIR" 2>/dev/null

# === Parse payload ===
payload=$(cat)
tool_name=$(echo "$payload" | jq -r '.tool_name // empty' 2>/dev/null)
bg_flag=$(echo "$payload" | jq -r '.tool_input.run_in_background // false' 2>/dev/null)
cmd=$(echo "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)
desc=$(echo "$payload" | jq -r '.tool_input.description // empty' 2>/dev/null)

# === 필터: Bash + bg 만 처리 ===
if [ "$tool_name" != "Bash" ] || [ "$bg_flag" != "true" ]; then
  exit 0
fi

# === Case 1: 본 호출이 "주기적확인요망" 동반 task → marker 갱신 + 통과 ===
if echo "$desc $cmd" | grep -qi "주기적확인요망"; then
  touch "$MARKER_FILE"
  ts=$(date +%Y%m%d-%H%M%S)
  echo "$ts companion task registered (desc=$desc)" >> "$LOG_DIR/marker.log"
  exit 0
fi

# === Case 2: 일반 Bash+bg → marker 확인 ===
marker_active=false
if [ -f "$MARKER_FILE" ]; then
  # macOS: stat -f %m, Linux: stat -c %Y
  if mtime=$(stat -f %m "$MARKER_FILE" 2>/dev/null) || mtime=$(stat -c %Y "$MARKER_FILE" 2>/dev/null); then
    now=$(date +%s)
    age=$(( now - mtime ))
    if [ "$age" -lt "$DELAY_SEC" ]; then
      marker_active=true
    else
      rm -f "$MARKER_FILE"
    fi
  fi
fi

if [ "$marker_active" = "true" ]; then
  exit 0
fi

# === Case 3: 차단 + 동반 task 등록 안내 ===
preview=$(echo "${desc:-$cmd}" | tr '\n' ' ' | cut -c1-100)
ts=$(date +%Y%m%d-%H%M%S)
echo "$ts blocked Bash+bg (no companion) preview=$preview" >> "$LOG_DIR/marker.log"

# stdout JSON 으로 차단 결정 (Claude Code PreToolUse decision schema)
cat <<EOF
{
  "decision": "block",
  "reason": "백그라운드 Bash 호출 전에 '주기적확인요망' 동반 task 가 먼저 등록되어야 합니다. 다음 두 Bash 호출을 같은 응답에 함께 보내세요: (1) Bash(command='sleep ${DELAY_SEC}; echo 주기적확인요망', description='주기적확인요망', run_in_background=true) — 이게 ${DELAY_SEC}초 후 task-notification 으로 자동 트리거. (2) 원래 의도한 본 명령. 순서: 먼저 동반 task 등록 → 그 다음 본 명령. (현재 차단된 명령: ${preview})"
}
EOF
exit 0
