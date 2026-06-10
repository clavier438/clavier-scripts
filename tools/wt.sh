#!/usr/bin/env bash
# door: system    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
# wt.sh — 멀티세션 git 작업트리 격리 front door (~/bin/wt)
#
# === 왜 존재하는가 (근본 원인) =============================================
# 콜로니(environment-peer 모델, 2026-05-03)는 한 호스트에 repo 당 *단일 클론* 을
# 둔다. 그런데 여러 Claude 세션(메인 + spawn_task 칩 + 백그라운드 Agent)이 동시에
# 그 *하나의 작업트리* 를 공유한다. `git checkout`/`git switch` 는 작업트리 전역
# 상태라 — 세션 A 가 브랜치 X 에서 일하는 동안 세션 B 가 `git checkout Y` 하면
# A 의 작업트리도 Y 로 갈아끼워지고, A 의 다음 커밋이 엉뚱한 브랜치에 얹힌다.
# (2026-06-08·06-09 실제 사고: 커밋이 의도와 다른 브랜치에 착지, main 이 작업 중
#  움직임, 같은 주제 중복 브랜치 다수. RAY_DALIO_QUEUE 2026-06-08 항목 참조.)
#
# 정석 해법 = git worktree: 세션마다 *독립된 작업 디렉토리* + 공유 .git. 한 세션의
# checkout 이 다른 세션을 건드릴 수 없다. 그동안 pre-commit 의 "canonical 클론 강제"
# 검사(2026-06-09 제거, #118)가 worktree 커밋을 막아 모두가 단일 클론에 몰렸다 —
# 그 검사가 사라진 지금, worktree 격리를 *기본 경로* 로 만드는 게 이 도구다.
#
# === 설계 (구조 3겹, 권유 아닌 장치) =======================================
#   1. 이 도구(wt)        — 격리를 한 줄로. 옳은 길을 *싸게* 만든다.
#   2. session-start hook — 매 세션 worktree 지형을 주입. 위험을 *보이게* 한다.
#   3. Sentinel `wt audit`— stray 브랜치·orphan worktree 야간 목록화. *치우는* 그물.
#
# === 사용 ===================================================================
#   wt new <branch>   현재 repo 의 origin/main 기준 새 worktree+브랜치 생성 후 경로 출력
#   wt                현황(= wt list)
#   wt list           이 repo 의 worktree 들 + 브랜치/ahead-behind/dirty
#   wt rm <name>      worktree 제거 (+ 머지된 브랜치면 삭제 제안)
#   wt audit          stray 브랜치 / orphan worktree / 중복-주제 목록 (읽기 전용; Sentinel 용)
#   wt help
#
# repo-aware: 현재 디렉토리가 속한 git repo 에 대해 동작한다 (clavier-scripts /
# clavier-hq / platform-workers 어디서든). worktree 는 콜로니 루트 `.worktrees/` 아래.

# freshness: 이 도구는 git 브랜치/worktree 를 *관리* 하므로 main 외 브랜치에서도
# 정상 동작해야 한다. freshness.sh 는 비-main 브랜치에선 즉시 return(무해)하고
# main 에서만 ff-pull 하므로 그대로 source 한다 (pre-commit (2) 충족 + 안전).
_WT_DIR="$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")"
. "$_WT_DIR/lib/freshness.sh"
. "$_WT_DIR/lib/repoPaths.sh"

set -u

# ── 색 ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
    C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'
    C_CYN=$'\033[36m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
    C_DIM=; C_RED=; C_GRN=; C_YEL=; C_CYN=; C_BLD=; C_RST=
fi

die() { printf '%swt: %s%s\n' "$C_RED" "$*" "$C_RST" >&2; exit 1; }

# ── 현재 repo 의 *메인* 작업트리 + 콜로니 worktree 베이스 ─────────────────
# 어느 worktree/디렉토리에서 호출돼도 그 repo 의 메인 작업트리를 기준으로 잡는다.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "git repo 안에서 실행하세요 (현재: $PWD)"

# git-common-dir → 메인 작업트리 root (linked worktree 에서도 동일하게 메인을 가리킴)
_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
[ -n "$_COMMON_DIR" ] || _COMMON_DIR="$(git rev-parse --git-common-dir)"
REPO_MAIN="$(cd "$(dirname "$_COMMON_DIR")" && pwd)"   # …/<repo>/.git → …/<repo>
REPO_NAME="$(basename "$REPO_MAIN")"
COLONY="$(cd "$REPO_MAIN/.." && pwd)"
WT_BASE="$COLONY/.worktrees"

# worktree 디렉토리 이름: <repo>__<sanitized-branch> (콜로니 .worktrees 공유 → 충돌 방지)
wt_dir_for() {
    local branch="$1"
    printf '%s/%s__%s' "$WT_BASE" "$REPO_NAME" "$(printf '%s' "$branch" | tr '/ ' '--')"
}

g() { git -C "$REPO_MAIN" "$@"; }   # 메인 작업트리 기준 git

# ── 브랜치/머지 헬퍼 ──────────────────────────────────────────────────────
branch_exists_local()  { g show-ref --verify --quiet "refs/heads/$1"; }
branch_exists_origin() { g show-ref --verify --quiet "refs/remotes/origin/$1"; }
fetch_main() { g fetch --quiet origin main 2>/dev/null || true; }

# ── wt new ───────────────────────────────────────────────────────────────
cmd_new() {
    local branch="${1:-}"
    [ -n "$branch" ] || die "브랜치 이름이 필요합니다.  예: wt new feat/my-thing"
    case "$branch" in
        -*|*' '*) die "브랜치 이름이 이상합니다: '$branch'" ;;
    esac

    fetch_main

    # 중복 방어 — 같은/비슷한 작업이 이미 진행 중인지 (멀티세션 중복 브랜치 = 증상 #3)
    if branch_exists_local "$branch"; then
        die "로컬 브랜치 '$branch' 이미 존재 (다른 세션 소유 가능). 'wt list' 로 확인."
    fi
    if branch_exists_origin "$branch"; then
        printf '%s⚠ origin/%s 이미 존재 — 다른 세션이 같은 작업을 진행 중일 수 있습니다.%s\n' "$C_YEL" "$branch" "$C_RST" >&2
        printf '   그래도 새 worktree 를 만들려면 다른 브랜치명을 쓰거나, 기존 것을 이어받으세요.\n' >&2
        die "중복 회피: 진행 전 'gh pr list' / 'wt list' 로 확인하세요."
    fi
    # 같은 tip-subject 를 가진 다른 브랜치(=같은 커밋 중복) 경고
    _warn_duplicate_subject "$branch"

    local dir; dir="$(wt_dir_for "$branch")"
    [ -e "$dir" ] && die "worktree 디렉토리 이미 존재: $dir"

    mkdir -p "$WT_BASE"
    printf '%s○ %s 에 worktree 생성 (origin/main 기준, 브랜치 %s)…%s\n' "$C_DIM" "$dir" "$branch" "$C_RST" >&2
    g worktree add -b "$branch" "$dir" origin/main >&2 || die "worktree 생성 실패"

    printf '\n%s✓ 격리 worktree 준비됨%s — 여기서 작업·커밋·PR 하세요:\n\n' "$C_GRN" "$C_RST" >&2
    printf '    cd %s\n\n' "$dir" >&2
    # stdout 에는 경로만 — `cd "$(wt new ...)"` 로 쓸 수 있게
    printf '%s\n' "$dir"
}

# 서로 다른 origin 브랜치 둘 이상이 같은 tip subject → 중복 작업 의심.
# origin/main·HEAD 제외, 로컬↔origin 미러 쌍은 애초에 안 봄 (refs/remotes/origin 만).
_duplicate_subjects() {
    g for-each-ref --format='%(refname:short)|%(contents:subject)' refs/remotes/origin 2>/dev/null \
        | grep -vE '^origin/(main|HEAD)\|' \
        | sed 's/^origin\/[^|]*|//' \
        | sort | uniq -d
}

_warn_duplicate_subject() {
    local dups; dups="$(_duplicate_subjects | head -5)"
    [ -n "$dups" ] && {
        printf '%s⚠ 같은 커밋 제목을 가진 origin 브랜치가 둘 이상 (중복 작업 의심):%s\n' "$C_YEL" "$C_RST" >&2
        printf '%s\n' "$dups" | sed 's/^/     · /' >&2
    }
}

# ── wt list ──────────────────────────────────────────────────────────────
cmd_list() {
    fetch_main
    printf '%s%s worktrees%s  (.git 공유, 각 = 독립 세션 후보)\n' "$C_BLD" "$REPO_NAME" "$C_RST"
    local line path branch
    g worktree list --porcelain | awk '
        /^worktree /{p=substr($0,10)}
        /^branch /{b=substr($0,8); sub("refs/heads/","",b); print p"\t"b}
        /^detached/{print p"\tdetached"}
    ' | while IFS=$'\t' read -r path branch; do
        local tag="" ab="" dirty=""
        [ "$path" = "$REPO_MAIN" ] && tag="${C_CYN} ← 공유 콜로니 클론${C_RST}"
        if [ "$branch" != "detached" ]; then
            local counts
            counts="$(git -C "$path" rev-list --left-right --count "origin/main...$branch" 2>/dev/null)"
            if [ -n "$counts" ]; then
                local behind ahead
                behind="$(printf '%s' "$counts" | awk '{print $1+0}')"
                ahead="$(printf '%s' "$counts" | awk '{print $2+0}')"
                [ "$ahead"  -gt 0 ] && ab="${ab}${C_GRN}↑$ahead${C_RST}"
                [ "$behind" -gt 0 ] && ab="${ab} ${C_YEL}↓$behind${C_RST}"
            fi
            git -C "$path" diff --quiet 2>/dev/null && git -C "$path" diff --cached --quiet 2>/dev/null \
                || dirty="${C_RED}●dirty${C_RST}"
        fi
        printf '  %-50s %s%-28s%s %s %s%s\n' \
            "${path/#$COLONY\//}" "$C_BLD" "$branch" "$C_RST" "$ab" "$dirty" "$tag"
    done
    printf '\n%s새 작업 → wt new <branch>   정리 → wt rm <name>   감사 → wt audit%s\n' "$C_DIM" "$C_RST"
}

# ── wt rm ────────────────────────────────────────────────────────────────
cmd_rm() {
    local name="${1:-}"
    [ -n "$name" ] || die "제거할 worktree 이름/경로가 필요합니다 ('wt list' 참고)."
    # 이름으로 경로 해석: 절대경로 / .worktrees 하위 디렉토리명 / 브랜치명 모두 허용
    local dir=""
    if [ -d "$name" ]; then dir="$(cd "$name" && pwd)"
    elif [ -d "$WT_BASE/$name" ]; then dir="$WT_BASE/$name"
    else
        # 브랜치명으로 매칭
        dir="$(g worktree list --porcelain | awk -v b="refs/heads/$name" '
            /^worktree /{p=substr($0,10)} /^branch /{if($0=="branch "b) print p}')"
    fi
    [ -n "$dir" ] && [ -d "$dir" ] || die "worktree 를 못 찾음: $name"
    [ "$dir" = "$REPO_MAIN" ] && die "공유 콜로니 클론은 제거할 수 없습니다."

    local wbranch; wbranch="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || echo "")"
    g worktree remove "$dir" 2>/dev/null || g worktree remove --force "$dir" || die "worktree 제거 실패 (dirty? --force 수동)"
    printf '%s✓ worktree 제거: %s%s\n' "$C_GRN" "$dir" "$C_RST"

    if [ -n "$wbranch" ] && branch_exists_local "$wbranch"; then
        if g branch --merged origin/main | tr -d ' *' | grep -qx "$wbranch"; then
            g branch -d "$wbranch" >/dev/null 2>&1 \
                && printf '%s  ✓ 머지된 브랜치 삭제: %s%s\n' "$C_GRN" "$wbranch" "$C_RST"
        else
            printf '%s  ℹ 브랜치 %s 는 아직 origin/main 에 미머지 — 보존. 삭제하려면: git -C %s branch -D %s%s\n' \
                "$C_DIM" "$wbranch" "$REPO_MAIN" "$wbranch" "$C_RST"
        fi
    fi
}

# ── wt audit (읽기 전용 — Sentinel 야간 + 사람) ──────────────────────────
cmd_audit() {
    fetch_main
    local found=0
    printf '%s== wt audit: %s ==%s\n' "$C_BLD" "$REPO_NAME" "$C_RST"

    # 1) upstream gone (머지 후 origin 에서 삭제된 브랜치) 인데 로컬 잔존
    local gone
    gone="$(g branch -vv | awk '/: gone\]/{print $1}' | sed 's/^\*//')"
    if [ -n "$gone" ]; then
        found=1
        printf '\n%s● upstream gone (머지·삭제됐는데 로컬 잔존) → 정리 후보:%s\n' "$C_YEL" "$C_RST"
        printf '%s\n' "$gone" | sed 's/^/    git branch -D /'
    fi

    # 2) origin/main 에 완전 머지됐는데 로컬 잔존 (main 제외)
    local merged
    merged="$(g branch --merged origin/main | tr -d ' *' | grep -vx main | grep -v '^+' || true)"
    if [ -n "$merged" ]; then
        found=1
        printf '\n%s● origin/main 에 머지된 로컬 브랜치 → 정리 후보:%s\n' "$C_YEL" "$C_RST"
        printf '%s\n' "$merged" | sed 's/^/    git branch -d /'
    fi

    # 3) orphan/stale worktree — origin/main 대비 0 commit *그리고* 작업트리도 깨끗
    #    (진행 중 세션은 미커밋 변경이 있어 제외 — false-positive 방지)
    g worktree list --porcelain | awk '
        /^worktree /{p=substr($0,10)} /^branch /{b=substr($0,8); sub("refs/heads/","",b); print p"\t"b}
    ' | while IFS=$'\t' read -r path branch; do
        [ "$path" = "$REPO_MAIN" ] && continue
        local ahead
        ahead="$(git -C "$path" rev-list --count "origin/main..$branch" 2>/dev/null || echo 0)"
        if [ "${ahead:-0}" -eq 0 ] \
           && git -C "$path" diff --quiet 2>/dev/null \
           && git -C "$path" diff --cached --quiet 2>/dev/null; then
            printf '%s● orphan worktree (origin/main 대비 0 commit, 깨끗) → wt rm:%s\n    %s  [%s]\n' \
                "$C_YEL" "$C_RST" "$path" "$branch"
        fi
    done

    # 4) 중복-주제 브랜치 (서로 다른 origin 브랜치가 같은 tip subject = 같은 작업 두 벌)
    local dupsub; dupsub="$(_duplicate_subjects)"
    if [ -n "$dupsub" ]; then
        found=1
        printf '\n%s● 중복 커밋 제목 (같은 작업 중복 브랜치 의심):%s\n' "$C_YEL" "$C_RST"
        printf '%s\n' "$dupsub" | sed 's/^/    · /'
    fi

    [ "$found" -eq 0 ] && printf '%s✓ stray 브랜치·중복 없음.%s\n' "$C_GRN" "$C_RST"
}

# ── wt help ──────────────────────────────────────────────────────────────
cmd_help() {
    sed -n '2,40p' "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")" | sed 's/^# \{0,1\}//'
}

# ── dispatch ──────────────────────────────────────────────────────────────
sub="${1:-list}"; shift 2>/dev/null || true
case "$sub" in
    new|n|add)        cmd_new  "$@" ;;
    list|ls|"")       cmd_list "$@" ;;
    rm|remove|del)    cmd_rm   "$@" ;;
    audit)            cmd_audit "$@" ;;
    help|-h|--help)   cmd_help ;;
    # bare `wt feat/foo` = new (slug 처럼 보이면)
    */*|feat|fix|chore|refactor|docs|wip) cmd_new "$sub" "$@" ;;
    *) printf '%s알 수 없는 명령: %s%s\n\n' "$C_RED" "$sub" "$C_RST" >&2; cmd_help; exit 1 ;;
esac
