#!/usr/bin/env bash
# wrangler-deploy-safe — deploy 전 git 동기화 검증.
#
# PRINCIPLES.md P4 의 L4 hook 구현 (2026-05-25 신설 후 hook 미박힘).
#
# 원칙: deploy = git push 동반 필수. drift 발생 시 fail-loud.
#
# 사고 (P4 큐 항목): 2026-05-13 wrangler deploy 후 git push 누락 → origin 어긋남.
# deploy 가 *완성된 코드* 의 배포여야 하는데 *로컬 only* 코드 deploy 가 가능했음
# = drift 의 정의적 사례.
#
# 본 wrapper 가 검증하는 것:
#   1. uncommitted 변경 0 (working tree clean)
#   2. unpushed commit 0 (origin/<branch> 와 동기)
#   3. 위 둘 통과 시에만 wrangler deploy <args> exec
#
# 사용:
#   wrangler-deploy-safe deploy                          # 기본 환경
#   wrangler-deploy-safe deploy --env mukayu             # 명시 환경
#   wrangler-deploy-safe deploy --name framer-sync       # name 지정
#
# 우회 (긴급 hotfix 등):
#   WRANGLER_DEPLOY_SAFE_BYPASS=1 wrangler-deploy-safe ...

source "$(dirname "$0")/lib/freshness.sh" 2>/dev/null || true

set -eo pipefail

# bypass — 명시적 환경변수 (우회 흔적 남김)
if [ "${WRANGLER_DEPLOY_SAFE_BYPASS:-}" = "1" ]; then
  echo "⚠️  WRANGLER_DEPLOY_SAFE_BYPASS=1 — 검증 우회. drift 책임은 사용자에게."
  exec wrangler "$@"
fi

# wrangler 자체 존재 확인 (P5 정신 — spawn 절대 경로 / PATH 명시)
if ! command -v wrangler >/dev/null 2>&1; then
  echo "❌ wrangler 명령을 찾을 수 없음. npm install -g wrangler 또는 npx wrangler 사용." >&2
  exit 1
fi

# git repo 안인지 확인
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ git repo 밖에서 deploy 시도. wrangler.toml 있는 repo 안에서 실행." >&2
  exit 1
fi

# 1. uncommitted 변경 검사
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "❌ uncommitted 변경 있음. commit + push 후 deploy."
  echo ""
  echo "   변경된 파일:"
  git status --short | sed 's/^/     /'
  echo ""
  echo "   해결:"
  echo "     git add <files> && git commit -m '...' && git push"
  echo "   또는 긴급: WRANGLER_DEPLOY_SAFE_BYPASS=1 wrangler-deploy-safe ..."
  exit 1
fi

# 2. 현 branch vs origin 동기화 검사
branch=$(git branch --show-current 2>/dev/null || echo "")
if [ -z "$branch" ]; then
  echo "❌ detached HEAD 상태. 브랜치에서 실행." >&2
  exit 1
fi

# fetch 시도 (네트워크 실패해도 진행 — local cache 기준)
git fetch origin "$branch" --quiet 2>/dev/null || \
  echo "⚠️  origin fetch 실패 — local cache 기준으로 검사."

if ! git rev-parse "origin/${branch}" >/dev/null 2>&1; then
  echo "❌ origin/${branch} 가 존재하지 않음 (branch 가 push 안 됨)."
  echo ""
  echo "   해결: git push -u origin ${branch}"
  exit 1
fi

unpushed=$(git log "origin/${branch}..HEAD" --oneline 2>/dev/null || echo "")
if [ -n "$unpushed" ]; then
  echo "❌ unpushed commit 있음. push 후 deploy."
  echo ""
  echo "   unpushed:"
  echo "$unpushed" | sed 's/^/     /'
  echo ""
  echo "   해결: git push"
  exit 1
fi

# 3. 모든 검증 통과 — wrangler deploy 실행
echo "✓ git 동기화 OK (branch=$branch, origin 일치)"
echo "→ wrangler $*"
echo ""
exec wrangler "$@"
