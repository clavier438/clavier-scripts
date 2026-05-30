# freshness.sh — 모든 .sh tool 의 첫 source.
#
# SSOT 의 두 번째 강제 장치 (pre-commit + post-commit 에 이어):
#   "stale 로컬 코드로 실행" 이라는 상태 자체가 존재할 수 없게 한다.
#
# 호출 방식 (caller 의 첫 실행 라인, shebang 다음):
#   . "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/freshness.sh"
#
# 동작 — freshness.mjs 동일. 자세한 사양은 그쪽 헤더 참조.
#
# 주의: 이 파일은 source 됨 (subshell X). exit 를 직접 부르면 caller 도 죽음.
# branch != main 일 때나 정상 sync 시엔 export 후 return 0.

[ "$_CLAVIER_FRESHNESS_OK" = "1" ] && return 0
if [ "$CLAVIER_LOCAL_DEV" = "1" ]; then export _CLAVIER_FRESHNESS_OK=1; return 0; fi
if [ -n "$GIT_DIR" ] || [ "$_CLAVIER_IN_HOOK" = "1" ]; then return 0; fi

_FRESHNESS_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 위 dirname 은 tools/lib 까지, ../ 로 tools/, 다시 cd ../ 로 repo root.
_FRESHNESS_REPO="$(cd "$_FRESHNESS_REPO/.." && pwd)"

_FRESHNESS_BRANCH="$(git -C "$_FRESHNESS_REPO" symbolic-ref --short HEAD 2>/dev/null)"
if [ -z "$_FRESHNESS_BRANCH" ]; then unset _FRESHNESS_REPO _FRESHNESS_BRANCH; return 0; fi

if [ "$_FRESHNESS_BRANCH" != "main" ]; then
    export _CLAVIER_FRESHNESS_OK=1
    unset _FRESHNESS_REPO _FRESHNESS_BRANCH
    return 0
fi

if ! git -C "$_FRESHNESS_REPO" fetch --quiet origin main 2>/dev/null; then
    printf '\033[33m! freshness: git fetch 실패 (오프라인?) — 로컬 main 으로 진행\033[0m\n' >&2
    export _CLAVIER_FRESHNESS_OK=1
    unset _FRESHNESS_REPO _FRESHNESS_BRANCH
    return 0
fi

_FRESHNESS_COUNTS="$(git -C "$_FRESHNESS_REPO" rev-list --left-right --count main...origin/main 2>/dev/null)"
_FRESHNESS_AHEAD="$(echo "$_FRESHNESS_COUNTS" | awk '{print $1+0}')"
_FRESHNESS_BEHIND="$(echo "$_FRESHNESS_COUNTS" | awk '{print $2+0}')"

if [ "$_FRESHNESS_AHEAD" -eq 0 ] && [ "$_FRESHNESS_BEHIND" -eq 0 ]; then
    export _CLAVIER_FRESHNESS_OK=1
    unset _FRESHNESS_REPO _FRESHNESS_BRANCH _FRESHNESS_COUNTS _FRESHNESS_AHEAD _FRESHNESS_BEHIND
    return 0
fi

if [ "$_FRESHNESS_AHEAD" -gt 0 ]; then
    # fail-open: freshness 는 인프라 경고일 뿐 — 절대 차단하지 않는다 (DECISIONS 2026-05-30).
    printf '\n\033[33m! freshness: 로컬 main 이 origin 보다 %s commit 앞섭니다 (경고만, 차단 안 함).\033[0m\n' "$_FRESHNESS_AHEAD" >&2
    printf '\033[33m    비정상일 수 있음. 조사:  git -C "%s" log origin/main..main\033[0m\n\n' "$_FRESHNESS_REPO" >&2
    export _CLAVIER_FRESHNESS_OK=1
    unset _FRESHNESS_REPO _FRESHNESS_BRANCH _FRESHNESS_COUNTS _FRESHNESS_AHEAD _FRESHNESS_BEHIND
    return 0
fi

if git -C "$_FRESHNESS_REPO" pull --ff-only --quiet origin main 2>/dev/null; then
    printf '\033[36mℹ freshness: origin/main 에서 %s 새 commit 적용\033[0m\n' "$_FRESHNESS_BEHIND" >&2
else
    # fail-open: 작업 트리가 더러워 자동 pull 못 해도 차단하지 않고 경고만 (DECISIONS 2026-05-30).
    printf '\n\033[33m! freshness: origin 보다 %s commit 뒤처짐 — 작업 트리가 더러워 자동 pull 못 함 (경고만, 차단 안 함).\033[0m\n' "$_FRESHNESS_BEHIND" >&2
    printf '\033[33m    정리되면 직접:  git -C "%s" pull --ff-only\033[0m\n\n' "$_FRESHNESS_REPO" >&2
fi
export _CLAVIER_FRESHNESS_OK=1
unset _FRESHNESS_REPO _FRESHNESS_BRANCH _FRESHNESS_COUNTS _FRESHNESS_AHEAD _FRESHNESS_BEHIND
return 0
