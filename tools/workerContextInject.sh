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
# 도메인 설정: tools/contextInject.json (OCP — 새 도메인 = JSON 편집만)

# jq 없으면 silent exit (JSON 조립 불가)
command -v jq >/dev/null || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/contextInject.json"

[ -f "$CONFIG" ] || exit 0

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // ""')

# contextInject.json에서 도메인별 키워드·파일 목록을 읽어 매칭
matched_files=""
matched_domain=""

domain_count=$(jq 'length' "$CONFIG")
for i in $(seq 0 $((domain_count - 1))); do
    domain=$(jq -r ".[$i].domain" "$CONFIG")
    keyword_count=$(jq ".[$i].keywords | length" "$CONFIG")

    for j in $(seq 0 $((keyword_count - 1))); do
        kw=$(jq -r ".[$i].keywords[$j]" "$CONFIG")
        if echo "$prompt" | grep -qiE "$kw"; then
            matched_domain="$domain"
            matched_files=$(jq -r ".[$i].files[]" "$CONFIG")
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
    label=$(basename "$(dirname "$filepath")")/$(basename "$filepath")
    if [ -f "$filepath" ]; then
        content=$(cat "$filepath")
    else
        content="(파일 없음: $filepath)"
    fi
    combined=$(printf '%s\n\n## %s\n\n%s' "$combined" "$label" "$content")
done <<< "$matched_files"

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
