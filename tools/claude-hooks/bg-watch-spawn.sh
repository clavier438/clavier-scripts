#!/bin/bash
# Claude Code PreToolUse hook — Bash + run_in_background=true 호출 시
# "주기적확인요망" 동반 sleep task enforce.
#
# 왜:
#   Claude 가 백그라운드 작업을 호출해 두고 "20분 마다 확인" 약속해도, turn-based
#   구조라 능동적 polling 없이는 누락. 이 hook 은 매 Bash+bg 호출마다 검사 —
#   동반 sleep task (description="주기적확인요망") 가 활성 상태가 아니면 *차단*
#   (continue with PreToolUse permissionDecision=deny). Claude 는 다음 응답에서
#   sleep task 를 먼저 등록해야만 본 작업이 통과됨.
#
#   sleep task 가 ${DELAY_SEC}초 후 완료되면 Claude Code 가 task-notification 으로
#   Claude 의 다음 turn 을 트리거 (경험적 관찰 — 공식 문서엔 명시 없음).
#
# Schema (공식 — Anthropic Claude Code Hooks 문서 기준):
#   PreToolUse stdin payload:
#     { session_id, cwd, hook_event_name="PreToolUse", tool_name, tool_input, tool_use_id }
#   PreToolUse stdout JSON 응답:
#     { "hookSpecificOutput": { "hookEventName": "PreToolUse",
#                               "permissionDecision": "allow"|"deny"|"ask"|"defer",
#                               "permissionDecisionReason": "..." }}
#   Exit codes:
#     0 = success; stdout JSON 파싱
#     2 = blocking error; stderr → Claude
#     other = non-blocking error
#
# 동작:
#   * tool_name == "Bash" + tool_input.run_in_background == true 인 호출만 검사
#   * description 또는 command 에 "주기적확인요망" 포함 → marker 갱신 + allow (exit 0)
#   * marker 없거나 mtime > ${DELAY_SEC}초 전 → deny + reason
#   * marker 살아있음 → allow (exit 0, no JSON)
#
# 회피 가능 경로:
#   1. hook 미등록 → 작동 안 함 (사용자 설정 책임)
#   2. Claude 가 deny reason 받고도 동반 task 없이 시도 → 또 deny (무한 차단)
#   3. sleep task 등록 안 하고 본 명령만 시도 → 매번 deny
#   = Claude 가 차단을 *우회할 방법 없음* — 동반 등록만이 통과 경로

set -u

DELAY_SEC="${WEBEXP_BG_WATCH_SEC:-1200}"
MARKER_FILE="${WEBEXP_BG_WATCH_MARKER:-/tmp/claude-periodic-active}"
LOG_DIR="${HOME}/.claude-bg-watch"
mkdir -p "$LOG_DIR" 2>/dev/null

payload=$(cat)

# jq 없으면 fallback (silent allow) — 등록 단계 실패 방지
if ! command -v jq >/dev/null 2>&1; then
  echo "$(date +%FT%T) WARN: jq not installed, hook bypass" >> "$LOG_DIR/marker.log"
  exit 0
fi

tool_name=$(echo "$payload" | jq -r '.tool_name // empty' 2>/dev/null)
bg_flag=$(echo "$payload" | jq -r '.tool_input.run_in_background // false' 2>/dev/null)
cmd=$(echo "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)
desc=$(echo "$payload" | jq -r '.tool_input.description // empty' 2>/dev/null)

# 필터: Bash + bg 만 처리
if [ "$tool_name" != "Bash" ] || [ "$bg_flag" != "true" ]; then
  exit 0
fi

# Case 1: 본 호출이 "주기적확인요망" 동반 task → marker 갱신 + 통과
if echo "$desc $cmd" | grep -qi "주기적확인요망"; then
  touch "$MARKER_FILE"
  echo "$(date +%FT%T) MARK desc='$desc'" >> "$LOG_DIR/marker.log"
  exit 0
fi

# Case 2: 일반 Bash+bg → marker 살아있는지 확인 (mac stat -f / linux stat -c fallback)
marker_active=false
age=0
mtime=""
if [ -f "$MARKER_FILE" ]; then
  if m=$(stat -f %m "$MARKER_FILE" 2>/dev/null); then mtime="$m"
  elif m=$(stat -c %Y "$MARKER_FILE" 2>/dev/null); then mtime="$m"
  fi
  if [ -n "$mtime" ]; then
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
  echo "$(date +%FT%T) PASS marker_age=${age}s cmd='${cmd:0:60}'" >> "$LOG_DIR/marker.log"
  exit 0
fi

# Case 3: 차단 + 동반 task 등록 지시 (single-line reason → JSON 안전)
preview=$(echo "${desc:-$cmd}" | tr '\n' ' ' | cut -c1-120)
echo "$(date +%FT%T) DENY preview='$preview'" >> "$LOG_DIR/marker.log"

reason="백그라운드 작업 (run_in_background=true) 시작 전에 '주기적확인요망' 동반 sleep task 가 활성화되어야 합니다. 다음 두 Bash 도구 호출을 같은 응답에 함께 보내세요. (1) 동반 task 먼저: Bash(command=\"sleep ${DELAY_SEC} && echo 주기적확인요망 완료\", description=\"주기적확인요망\", run_in_background=true). (2) 그 다음 본 명령: Bash(<원래 의도한 명령>, run_in_background=true). 동반 task 가 ${DELAY_SEC}초 후 완료되면 Claude 의 다음 turn 자동 트리거되어 진행 확인. 차단된 호출: ${preview}"

# python3 로 JSON escape (jq -Rs 는 control char 미escape 케이스 있음 — 안전한 대안)
reason_json=$(printf '%s' "$reason" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$reason_json}}
EOF
exit 0
