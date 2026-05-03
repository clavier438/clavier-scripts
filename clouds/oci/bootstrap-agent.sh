#!/usr/bin/env bash
# bootstrap-agent.sh — OCI peer 환경 부트스트랩 (Layer 2 / OCI)
#
# 목적: fresh Ubuntu VM 을 clavier environment-peer 로 만든다.
#   - Layer 0 (GitHub + Doppler) 접근 도구 설치
#   - Layer 1 실행 런타임 (Node.js, Claude Code) 설치
#   - sibling repo 자동 clone (clavier-hq, platform-workers)
#     → Layer 1 도구가 sibling-first 탐색이라 zero-config 작동
#
# 사용법 (OCI 서버 SSH 세션에서):
#   git clone https://github.com/clavier0/clavier-scripts ~/clavier-scripts
#   bash ~/clavier-scripts/clouds/oci/bootstrap-agent.sh
#
# 멱등: 재실행 안전. 이미 설치된 도구는 skip.
# DECISIONS.md "environment-peer 모델" 참조.

set -euo pipefail

log()  { printf '\033[1;36m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; }

# ── 0. 환경 검증 ──────────────────────────────────────────────
log "Step 0/5 — 환경 검증"

if [[ "$(uname -s)" != "Linux" ]]; then
    err "Linux 전용. 현재: $(uname -s). Mac 은 setup.sh 사용."
    exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
    err "apt-get 없음. Ubuntu/Debian 계열 가정."
    exit 1
fi

ARCH="$(uname -m)"
log "  OS: $(. /etc/os-release && echo "$PRETTY_NAME")"
log "  Arch: $ARCH"

# ── 1. apt 의존 패키지 ────────────────────────────────────────
log "Step 1/5 — apt 의존 패키지"

APT_PKGS=(jq git curl ca-certificates build-essential)
MISSING=()
for pkg in "${APT_PKGS[@]}"; do
    if dpkg -s "$pkg" >/dev/null 2>&1; then
        printf '  [skip] %s\n' "$pkg"
    else
        MISSING+=("$pkg")
    fi
done

if (( ${#MISSING[@]} > 0 )); then
    log "  설치: ${MISSING[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y "${MISSING[@]}"
fi

# ── 2. Node.js LTS (NodeSource) ───────────────────────────────
log "Step 2/5 — Node.js"

if command -v node >/dev/null 2>&1; then
    log "  [skip] $(node --version) 이미 설치"
else
    log "  NodeSource LTS 저장소 추가 후 설치"
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
    log "  설치 완료: $(node --version)"
fi

# ── 3. Doppler CLI ────────────────────────────────────────────
log "Step 3/5 — Doppler CLI"

if command -v doppler >/dev/null 2>&1; then
    log "  [skip] $(doppler --version) 이미 설치"
else
    curl -Ls --tlsv1.2 --proto '=https' --retry 3 https://cli.doppler.com/install.sh | sudo sh
    log "  설치 완료: $(doppler --version)"
fi

# ── 4. Claude Code CLI ────────────────────────────────────────
log "Step 4/5 — Claude Code CLI"

if command -v claude >/dev/null 2>&1; then
    log "  [skip] $(claude --version 2>/dev/null || echo 'claude') 이미 설치"
else
    log "  공식 installer 실행"
    curl -fsSL https://claude.ai/install.sh | bash
    # installer 가 ~/.local/bin 에 설치하므로 PATH 보장
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        if ! grep -q '\.local/bin' "$HOME/.bashrc" 2>/dev/null; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
            log "  ~/.bashrc 에 \$HOME/.local/bin PATH 추가"
        fi
        export PATH="$HOME/.local/bin:$PATH"
    fi
    log "  설치 완료"
fi

# ── 5. Sibling repo clone (graceful) ──────────────────────────
# Layer 1 도구(workerCtl, doc-coverage 등)가 sibling-first 탐색을 하므로
# clavier-hq, platform-workers 를 형제로 clone 해두면 zero-config 작동.
log "Step 5/6 — Sibling repo (~/clavier-hq, ~/platform-workers)"

PEER_REPOS=(clavier-hq platform-workers)
PARENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

for repo in "${PEER_REPOS[@]}"; do
    target="$PARENT_DIR/$repo"
    if [ -d "$target/.git" ]; then
        printf '  [skip] %s 이미 클론됨\n' "$repo"
    else
        if git clone "https://github.com/clavier0/$repo" "$target" 2>/dev/null; then
            printf '  [clone] %s → %s\n' "$repo" "$target"
        else
            warn "  $repo clone 실패 (private repo 인증 필요?). 수동 처리:"
            warn "    gh auth login   또는   git clone git@github.com:clavier0/$repo $target"
        fi
    fi
done

# ── 6. Doppler 로그인 상태 검증 ───────────────────────────────
log "Step 6/6 — Doppler 인증 상태"

if doppler me >/dev/null 2>&1; then
    log "  [ok] $(doppler me --json 2>/dev/null | jq -r '.email // .name // "logged in"')"
else
    warn "  Doppler 미인증. 다음 명령으로 로그인 후 재실행:"
    warn "    doppler login"
    warn "    doppler setup --project clavier --config prd"
fi

# ── 완료 ──────────────────────────────────────────────────────
echo ""
log "부트스트랩 완료"
echo ""
echo "  다음 단계:"
echo "    1. (필요 시) doppler login + doppler setup --project clavier --config prd"
echo "    2. (sibling clone 실패한 경우) 수동 git clone"
echo "    3. 에이전트 실행:"
echo "       cd ~/<repo> && doppler run -- claude"
echo ""
echo "  모바일에서 단발 작업 트리거:"
echo "    ssh ubuntu@168.107.63.94 \"cd ~/<repo> && doppler run -- claude -p '<task>'\""
echo ""
