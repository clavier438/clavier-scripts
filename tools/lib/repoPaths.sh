# repoPaths.sh — sibling-first repo 탐색 (shell 공유 헬퍼)
#
# repoPaths.mjs 의 shell 짝. 모든 .sh tool 이 이 파일 하나를 source 해서
# 같은 규칙으로 관련 repo 를 찾는다 — 이전엔 각 .sh 가 inline 재구현(또는 죽은
# iCloud 절대경로 하드코딩)했다. 그 불일치가 콜로니 이주 때 dead-path 사고를 냈다.
# DECISIONS 2026-05-03 environment-peer 모델 + CLAUDE.md "sibling-first 자동 탐색".
#
# 탐색: (1) env override → (2) sibling ($COLONY/<name>) → (3) 못 찾으면 빈 문자열.
# 절대경로 하드코딩 0 — 이 lib 자기 위치에서 도출하므로 어느 host(Mac/OCI/web)에서도 동일.
#
# 사용 (caller, freshness.sh source 직후):
#   . "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/repoPaths.sh"
#   echo "$CLAVIER_SCRIPTS"                 # 이 repo (clavier-scripts) 루트
#   echo "$CLAVIER_HQ" "$PLATFORM_WORKERS"  # 형제 repo (없으면 빈 문자열)
#   echo "$FRAMER_SYNC"                     # platform-workers/framer-sync (없으면 빈 문자열)
#
# 주의: 이 파일은 source 됨 (subshell X). exit 직접 호출 금지.

# 이 lib 자신의 경로 -> repo root (lib -> tools -> root). caller 위치와 무관.
_rp_self="${BASH_SOURCE[0]:-$0}"
_rp_lib_dir="$(cd "$(dirname "$(readlink "$_rp_self" 2>/dev/null || echo "$_rp_self")")" && pwd)"
CLAVIER_SCRIPTS="$(cd "$_rp_lib_dir/../.." && pwd)"
_RP_COLONY="$(cd "$CLAVIER_SCRIPTS/.." && pwd)"
unset _rp_self _rp_lib_dir
export CLAVIER_SCRIPTS

# find_repo NAME [ENVVAR] -> 절대경로 (stdout) 또는 빈 문자열 (+ return 1)
find_repo() {
    _rp_name="$1"; _rp_env="${2:-}"
    if [ -n "$_rp_env" ]; then
        eval "_rp_ov=\${$_rp_env:-}"
        if [ -n "$_rp_ov" ]; then printf '%s' "$_rp_ov"; return 0; fi
    fi
    if [ -d "$_RP_COLONY/$_rp_name" ]; then printf '%s' "$_RP_COLONY/$_rp_name"; return 0; fi
    return 1
}

# 표준 repo 편의 변수 (env override 존중 -> sibling -> 빈 문자열).
CLAVIER_HQ="$(find_repo clavier-hq CLAVIER_HQ)"
PLATFORM_WORKERS="$(find_repo platform-workers PLATFORM_WORKERS)"
FRAMER_SYNC="${FRAMER_SYNC_DIR:-${PLATFORM_WORKERS:+$PLATFORM_WORKERS/framer-sync}}"
export CLAVIER_HQ PLATFORM_WORKERS FRAMER_SYNC
