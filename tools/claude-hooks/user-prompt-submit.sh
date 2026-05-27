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

command -v jq >/dev/null || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/user-prompt-submit.config.json"

# 콜로니 root — sibling-first 자동 탐색 (CONCEPTS #15).
# config.json 의 files 는 *콜로니 상대경로* (예: "clavier-hq/SYSTEM_ENV.md").
# recipe 의 shell 명령은 $COLONY 환경변수 사용 가능.
# host-agnostic JSON + .sh 에서 prepend.
COLONY="${CLAVIER_COLONY:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"   # claude-hooks → tools → scripts-root → colony
export COLONY

[ -f "$CONFIG" ] || exit 0

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // ""')

# config 에서 도메인별 키워드 매칭 → idx 캡처
matched_domain=""
matched_idx=""

domain_count=$(jq 'length' "$CONFIG")
for i in $(seq 0 $((domain_count - 1))); do
    domain=$(jq -r ".[$i].domain" "$CONFIG")
    keyword_count=$(jq ".[$i].keywords | length" "$CONFIG")

    for j in $(seq 0 $((keyword_count - 1))); do
        kw=$(jq -r ".[$i].keywords[$j]" "$CONFIG")
        if echo "$prompt" | grep -qiE "$kw"; then
            matched_domain="$domain"
            matched_idx="$i"
            break 2
        fi
    done
done

# 키워드 미매칭 시 silent exit
[ -z "$matched_domain" ] && exit 0

# 매칭된 도메인의 files (정적 .md) + recipe (shell 명령) 둘 다 수집.
# recipe = 생성형 도큐. head/git log 등으로 코드·커밋 본체에서 직접 추출 → drift 0.
matched_files=$(jq -r ".[$matched_idx].files[]? // empty" "$CONFIG")
matched_recipe=$(jq -r ".[$matched_idx].recipe[]? // empty" "$CONFIG")

header="# === [auto-inject: 도메인=$matched_domain — UserPromptSubmit hook] ==="
combined="$header"

# files — 정적 .md cat
while IFS= read -r filepath; do
    [ -z "$filepath" ] && continue
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

# recipe — shell 명령 실행. $COLONY 사용 가능. 5초 cap.
while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    if command -v timeout >/dev/null; then
        output=$(timeout 5 bash -c "$cmd" 2>&1)
    else
        output=$(bash -c "$cmd" 2>&1)
    fi
    combined=$(printf '%s\n\n## $ %s\n\n%s' "$combined" "$cmd" "$output")
done <<< "$matched_recipe"

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
