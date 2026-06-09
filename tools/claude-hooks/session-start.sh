#!/usr/bin/env bash
# sessionStartContext.sh — Claude Code SessionStart hook용 컨텍스트 자동 주입
#
# 왜 존재하는가: CLAUDE.md만으로는 모델이 "clavier-hq 먼저 읽기" 지침을
# 가끔 흘끔만 보고 작업으로 뛰어드는 경우가 있음. 시스템 레이어에서
# 핵심 문서들을 컨텍스트에 강제 주입하면 모델이 무시할 수 없게 됨.
#
# 출력: hookSpecificOutput JSON (Claude Code SessionStart hook 규약)

. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/../lib/freshness.sh"

# clavier-hq 위치 — sibling-first 자동 탐색 (CONCEPTS #15).
# env override > sibling 디렉토리 > 못 찾으면 silent skip (도면 빠진 채로 진행).
_SELF_DIR_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_SCRIPTS_ROOT="$(cd "$_SELF_DIR_SH/../.." && pwd)"   # claude-hooks → tools → scripts-root
HQ="${CLAVIER_HQ:-$_SCRIPTS_ROOT/../clavier-hq}"
[ -d "$HQ/.git" ] || HQ=""   # 못 찾으면 head/extract 가 silent 빈 결과 반환

# clavier-hq 최신 상태로 업데이트 (네트워크 실패해도 진행)
if [ -n "$HQ" ] && [ -d "$HQ/.git" ]; then
    git -C "$HQ" pull --quiet 2>/dev/null || true
fi

# ## 헤더에 marker가 포함된 섹션 추출 (다음 ## 까지, 최대 limit줄)
extract_section() {
    local file="$1" marker="$2" limit="${3:-9999}"
    awk -v m="$marker" -v lim="$limit" '
        /^## /{if(p) exit; p=(index($0, m)>0)}
        p{print; c++; if(c>=lim) exit}
    ' "$file"
}

# HQ 못 찾았으면 모든 추출이 빈 결과 — silent skip (도면이라도 주입되게)
if [ -z "$HQ" ]; then
    mission="(clavier-hq 못 찾음 — bootstrap ensure 또는 CLAVIER_HQ env 설정 필요)"
    status=""; queue_active=""; queue_p0=""
else

# MISSION: 첫 20줄 (STL 원칙 핵심)
mission=$(head -20 "$HQ/MISSION.md" 2>/dev/null || echo "(파일 없음: MISSION.md)")

# STATUS: 첫 30줄 (프로젝트 현황 테이블 포함)
status=$(head -30 "$HQ/STATUS.md" 2>/dev/null || echo "(파일 없음: STATUS.md)")

# QUEUE: 진행 중(🟢) 섹션 전체 + P0(🔴) 섹션 첫 20줄
queue_active=$(extract_section "$HQ/QUEUE.md" "🟢")
queue_p0=$(extract_section "$HQ/QUEUE.md" "🔴" 20)
fi  # HQ 없음 분기 끝

combined="# === MISSION (STL 원칙 요약) ===
$mission

# === STATUS (현재 상태) ===
$status

# === QUEUE 진행 중 ===
$queue_active"

if [ -n "$queue_p0" ]; then
    combined="$combined

# === QUEUE P0 즉시 시정 (상위 20줄) ===
$queue_p0"
fi

# 시스템 자동화 실측 도면 — systemMap.mjs 가 ~/Library/LaunchAgents 를 직접 렌더.
# 손으로 쓴 현황 도면(사본)은 반드시 drift → 매 세션 *생성*해 주입한다
# (DECISIONS 2026-05-18 "생성형 도면"). 생성 실패는 침묵 아닌 시끄러운 마커로.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSMAP_MJS="$SELF_DIR/../systemMap.mjs"   # claude-hooks → tools/systemMap.mjs
sysmap=$(node "$SYSMAP_MJS" 2>&1)
if [ $? -ne 0 ] || [ -z "$sysmap" ]; then
    sysmap="# === ⚠️ 시스템 자동화 도면 생성 실패 ===
systemMap.mjs 실행 실패. 현재 자동화 상태를 신뢰하지 말 것.
\`node '$SYSMAP_MJS'\` 를 직접 실행해 진단."
fi
combined="$combined

$sysmap"

# Tier 3 routines 등록 대기 마커 — setup.sh Step 9 가 박음 (포맷 후 한 번)
ROUTINES_PENDING="$HOME/.clavier/routines-pending"
if [ -f "$ROUTINES_PENDING" ]; then
    combined="$combined

# === ⚠️ Tier 3 routines 등록 대기 (포맷 후 1회) ===

마커 발견: \`~/.clavier/routines-pending\` (setup.sh Step 9 가 박음).

**행동**: 다른 작업 시작 전에
1. \`mcp__scheduled-tasks__list_scheduled_tasks\` 호출 — 현재 등록 현황 확인.
2. 4 routines (closer/ray-dalio/sentinel/architect) 모두 등록 안돼있으면 사용자에 \"/registerRoutines 한 번 실행하면 4 routines 일괄 등록\" 권유.
3. 사용자 yes 시 → /registerRoutines slash command 실행 (~/.claude/commands/registerRoutines.md). 마커는 그 명령이 삭제.

이미 모두 등록돼있으면 마커만 조용히 삭제 (\`rm ~/.clavier/routines-pending\`)."
fi

# ── 🌿 Git 작업트리 지형 주입 — 멀티세션 브랜치 충돌 방지 (구조 장치 2/3) ──────
# 콜로니는 repo 당 단일 클론인데 여러 세션이 그 *하나의 작업트리* 를 공유한다.
# `git checkout` 은 작업트리 전역 상태 → 세션 A 작업 중 세션 B 의 checkout 이
# A 의 브랜치를 갈아끼우고 커밋이 엉뚱한 브랜치에 얹힌다 (2026-06-08·09 실사고).
# 정석 해법 = git worktree (세션별 독립 디렉토리). 매 세션 *지형을 보이게* 해서
# 작업 시작 전 격리(wt)를 유도한다. front door = tools/wt.sh (~/bin/wt).
# (best-effort, 네트워크 안 씀 — 로컬 worktree list 만. 실패해도 침묵 skip.)
_wt_landscape() {
    git -C "$_SCRIPTS_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
    local cur lines
    cur="$(git -C "$_SCRIPTS_ROOT" symbolic-ref --short HEAD 2>/dev/null || echo detached)"
    lines="$(git -C "$_SCRIPTS_ROOT" worktree list --porcelain 2>/dev/null | awk '
        /^worktree /{p=substr($0,10)}
        /^branch /{b=substr($0,8); sub("refs/heads/","",b); print "  · "p"  ["b"]"}
        /^detached/{print "  · "p"  [detached]"}')"
    [ -z "$lines" ] && return 0
    local n; n="$(printf '%s\n' "$lines" | grep -c .)"

    printf '# === 🌿 Git 작업트리 격리 — 멀티세션 브랜치 충돌 방지 ===\n\n'
    printf 'clavier-scripts worktree 현황 (.git 공유, 각 = 독립 세션 후보):\n%s\n\n' "$lines"
    if [ "$cur" != "main" ]; then
        printf '⚠ **지금 공유 콜로니 클론이 main 이 아닌 `%s` 에 있습니다** — 다른 세션이 그 브랜치에서\n' "$cur"
        printf '  작업 중일 수 있습니다. 이 클론에서 브랜치를 갈아끼우거나 커밋하지 마세요. 당신 작업은\n'
        printf '  반드시 격리 worktree 에서:\n\n'
    elif [ "$n" -gt 1 ]; then
        printf '⚠ 동시 worktree %s개 = 다른 세션 활성 가능. 작업은 자신의 worktree 안에서만:\n\n' "$n"
    else
        printf '작업을 *시작하기 전에* 격리 worktree 를 만드세요 (브랜치 충돌의 근본 차단):\n\n'
    fi
    printf '    cd "$(wt new <branch>)"   # origin/main 기준 새 worktree+브랜치 생성 후 그리로 이동\n'
    printf '    wt list                   # 현황   ·   wt audit  # stray 브랜치/orphan worktree 점검\n\n'
    printf '규칙: 공유 클론(clavier-scripts)에서 `git checkout <다른-브랜치>` 금지 — 다른 세션 작업을\n'
    printf '  갈아끼웁니다. 다른 브랜치가 필요하면 항상 `wt` 로 별도 worktree 에서. (설계: tools/wt.sh 헤더)\n'
}
_WT_BLOCK="$(_wt_landscape 2>/dev/null)"
if [ -n "$_WT_BLOCK" ]; then
    combined="$combined

$_WT_BLOCK"
fi

echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$(echo "$combined" | jq -Rs .)}}"
