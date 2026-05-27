#!/usr/bin/env bash
# workerContextInject.sh — Claude Code UserPromptSubmit hook
#
# 왜 존재하는가: 워커 관련 작업 시 ARCHITECTURE.md를 안 읽고 코드부터 수정하다가
# 설계 의도를 모른 채 수정하면 의도하지 않은 퇴행이 발생함 (MISSION 책무 8번).
# 사용자 프롬프트에 워커 키워드가 등장하면 시스템 레이어에서 강제 주입.
#
# 출력: hookSpecificOutput JSON (Claude Code UserPromptSubmit hook 규약)
# 키워드 미매칭 시: silent exit (컨텍스트 주입 없음)
#
# 도메인 설정: tools/claude-hooks/user-prompt-submit.config.json
# (옆에 둠 — SvelteKit 정신: 같은 hook 의 코드와 데이터를 폴더로 결속.
# OCP — 새 도메인 = JSON 편집만)

# jq 없으면 silent exit (JSON 조립 불가)

. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/../lib/freshness.sh"

# Claude Code 가 GUI 진입점에서 호출 시 ~/bin 이 PATH 에 없을 수 있음.
# commands 필드(sisters 등) 가 ~/bin wrapper 로 박힌 경우 발견되도록 보강.
case ":$PATH:" in
    *":$HOME/bin:"*) ;;
    *) export PATH="$HOME/bin:$PATH" ;;
esac

command -v jq >/dev/null || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/user-prompt-submit.config.json"

# 콜로니 root — sibling-first 자동 탐색 (CONCEPTS #15).
# config.json 의 files 는 *콜로니 상대경로* (예: "clavier-hq/SYSTEM_ENV.md").
# host-agnostic JSON + .sh 에서 prepend.
COLONY="${CLAVIER_COLONY:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"   # claude-hooks → tools → scripts-root → colony

[ -f "$CONFIG" ] || exit 0

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // ""')

# contextInject.json에서 도메인별 키워드·파일·명령 목록을 읽어 매칭
matched_files=""
matched_commands=""
matched_domain=""

domain_count=$(jq 'length' "$CONFIG")
for i in $(seq 0 $((domain_count - 1))); do
    domain=$(jq -r ".[$i].domain" "$CONFIG")
    keyword_count=$(jq ".[$i].keywords | length" "$CONFIG")

    for j in $(seq 0 $((keyword_count - 1))); do
        kw=$(jq -r ".[$i].keywords[$j]" "$CONFIG")
        if echo "$prompt" | grep -qiE "$kw"; then
            matched_domain="$domain"
            matched_files=$(jq -r ".[$i].files // [] | .[]" "$CONFIG")
            matched_commands=$(jq -r ".[$i].commands // [] | .[]" "$CONFIG")
            break 2
        fi
    done
done

# 키워드 미매칭 시 silent exit
[ -z "$matched_domain" ] && exit 0

# 파일 내용 수집 (존재하는 파일만)
header="# === [worker context auto-inject — 워커 키워드 감지] ==="
combined="$header"

while IFS= read -r filepath; do
    [ -z "$filepath" ] && continue
    # 절대경로면 그대로, 상대경로면 콜로니 root 기준 (sibling-first).
    case "$filepath" in
        /*) abspath="$filepath" ;;
        *)  abspath="$COLONY/$filepath" ;;
    esac
    label=$(basename "$(dirname "$abspath")")/$(basename "$abspath")
    if [ -f "$abspath" ]; then
        content=$(cat "$abspath")
    else
        content="(파일 없음: $abspath)"
    fi
    combined=$(printf '%s\n\n## %s\n\n%s' "$combined" "$label" "$content")
done <<< "$matched_files"

# 명령 실행 결과 주입 (sisters 등 생성형 manifest).
# 첫 단어가 PATH 에 있을 때만 시도 — 없으면 silent skip.
# CLAVIER_LOCAL_DEV=1: 분석 도구는 stale 강제 검사 우회 (hook 은 정보 주입용,
# fresh 강제는 사용자 직접 명령 실행 시 따로 동작).
while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    first=$(printf '%s' "$cmd" | awk '{print $1}')
    command -v "$first" >/dev/null 2>&1 || continue
    cmd_output=$(env NO_COLOR=1 CLAVIER_LOCAL_DEV=1 sh -c "$cmd" 2>/dev/null) || cmd_output=""
    [ -z "$cmd_output" ] && continue
    combined=$(printf '%s\n\n## $ %s\n\n```\n%s\n```' "$combined" "$cmd" "$cmd_output")
done <<< "$matched_commands"

# 100KB 캡 — 초과 시 잘라내고 경고 추가
MAX_BYTES=102400
byte_size=${#combined}
if [ "$byte_size" -gt "$MAX_BYTES" ]; then
    combined="${combined:0:$MAX_BYTES}"
    combined=$(printf '%s\n\n[truncated: %d KB exceeded 100 KB cap]' \
        "$combined" $(( byte_size / 1024 )))
fi

# jq로 안전하게 JSON 조립
jq -n --arg ctx "$combined" \
    '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
