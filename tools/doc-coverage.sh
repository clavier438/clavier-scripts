#!/usr/bin/env bash
# doc-coverage.sh — 개념 키워드의 표준 문서 커버리지 검사
#
# 클린아키텍처 보호 도구: 새 결정(ADR)이 시스템 전체 문서에 일관되게 반영됐는지 확인.
# 누락 발견 시 즉시 보고 (post-commit 훅에서 자동 호출 + 수동 호출 모두 가능).
#
# 사용:
#   doc-coverage <개념>           특정 개념 커버리지 검사
#   doc-coverage --recent         DECISIONS.md 최신 ADR에서 자동 추출
#   doc-coverage --list           표준 문서 목록 출력
#
# 종료 코드:
#   0 = 모든 문서가 개념을 인지함
#   1 = 누락 발견 (어떤 문서가 모르고 있는지 출력)
#   2 = 사용법 오류

set -euo pipefail

HQ="${CLAVIER_HQ:-/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/clavier-hq}"
SCRIPTS="${CLAVIER_SCRIPTS:-/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/scripts}"

# 표준 문서 목록 — 시스템 전체 인지 검증 대상.
# 새 문서 추가 시 이 배열에 한 줄 추가.
CANONICAL_DOCS=(
    "$HQ/MISSION.md|hq/MISSION"
    "$HQ/STATUS.md|hq/STATUS"
    "$HQ/QUEUE.md|hq/QUEUE"
    "$HQ/SYSTEM_ENV.md|hq/SYSTEM_ENV"
    "$HQ/MANUAL.md|hq/MANUAL"
    "$HQ/DECISIONS.md|hq/DECISIONS"
    "$HQ/CONCEPTS.md|hq/CONCEPTS"
    "$SCRIPTS/CLAUDE.md|scripts/CLAUDE"
    "$SCRIPTS/README.md|scripts/README"
    "$SCRIPTS/ARCHITECTURE.md|scripts/ARCHITECTURE"
    "$SCRIPTS/CONVENTIONS.md|scripts/CONVENTIONS"
    "$SCRIPTS/env.md|scripts/env"
)

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; BOLD='\033[1m'; DIM='\033[2m'; OFF='\033[0m'

usage() {
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
}

list_docs() {
    echo "표준 문서 (${#CANONICAL_DOCS[@]}개):"
    for entry in "${CANONICAL_DOCS[@]}"; do
        IFS='|' read -r path label <<< "$entry"
        if [[ -f "$path" ]]; then
            echo "  ✅ $label"
        else
            echo "  ⚠️  $label (파일 없음: $path)"
        fi
    done
}

extract_recent_concept() {
    # ADR 제목에서 핵심 키워드 추출. ' — ' (em dash 구분자) 앞부분만 사용.
    # 부제·설명을 제외해 다른 문서가 짧게 언급한 경우도 매치되도록.
    # 예: "Notion Architecture Archive — 교육용 미러 (이중 인덱스)" → "Notion Architecture Archive"
    if [[ ! -f "$HQ/DECISIONS.md" ]]; then
        echo "ERROR: $HQ/DECISIONS.md 없음" >&2
        return 1
    fi
    awk '
        /^## [0-9]{4}-[0-9]{2}-[0-9]{2}:/ {
            sub(/^## [0-9]{4}-[0-9]{2}-[0-9]{2}: */, "")
            sub(/ +— .*/, "")   # em dash 구분자 이후 제거
            sub(/ +\(.*/, "")    # 괄호 부제 제거
            print; exit
        }
    ' "$HQ/DECISIONS.md"
}

check_coverage() {
    local concept="$1"
    local missing=0
    local total=${#CANONICAL_DOCS[@]}

    printf "${BOLD}커버리지 검사:${OFF} '${concept}'\n\n"

    for entry in "${CANONICAL_DOCS[@]}"; do
        IFS='|' read -r path label <<< "$entry"
        if [[ ! -f "$path" ]]; then
            printf "  ${YELLOW}⚠️  %-25s 파일 없음${OFF}\n" "$label"
            ((missing++))
            continue
        fi
        # grep -c 는 매치 0건일 때 exit code 1 — `|| echo 0` 쓰면 "0\n0" 오염됨.
        # `|| true` 로 종료코드만 무시하고, 실제 값은 grep 출력 그대로.
        local count
        count=$(grep -ci "$concept" "$path" 2>/dev/null || true)
        count=${count:-0}
        if [[ "${count:-0}" -gt 0 ]] 2>/dev/null; then
            printf "  ${GREEN}✅ %-25s${OFF} ${DIM}%d회${OFF}\n" "$label" "$count"
        else
            printf "  ${RED}❌ %-25s 0회 — 갱신 필요${OFF}\n" "$label"
            ((missing++))
        fi
    done

    echo ""
    if [[ "$missing" -eq 0 ]]; then
        printf "${GREEN}${BOLD}✅ 전체 ${total}개 문서 모두 '${concept}' 인지${OFF}\n"
        return 0
    else
        printf "${RED}${BOLD}❌ ${missing}/${total} 문서가 '${concept}'를 모름 — 즉시 갱신 필요${OFF}\n"
        printf "${DIM}위 ❌ 파일들에 해당 개념을 명시적으로 언급하도록 갱신.${OFF}\n"
        return 1
    fi
}

if [[ $# -eq 0 ]]; then
    usage
fi

case "${1:-}" in
    --help|-h)  usage ;;
    --list)     list_docs ;;
    --recent)
        concept=$(extract_recent_concept)
        if [[ -z "$concept" ]]; then
            echo "ERROR: DECISIONS.md에서 최신 ADR 추출 실패" >&2
            exit 2
        fi
        echo "→ 최신 ADR: $concept"
        echo ""
        check_coverage "$concept"
        ;;
    *)
        check_coverage "$1"
        ;;
esac
