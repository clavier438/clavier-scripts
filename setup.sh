#!/usr/bin/env bash
# setup.sh — 포맷 후 전체 환경 복구 스크립트
# 실행: bash ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/0/scripts/setup.sh

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHAGENTS_SRC="$SCRIPTS_DIR/daemons"
BIN_DIR="$HOME/bin"

echo "======================================"
echo "  환경 복구 시작"
echo "======================================"
echo ""

# ── 1. Homebrew 확인 ──────────────────────────────────────────
echo "[ 1/5 ] Homebrew 확인..."
if ! command -v brew &>/dev/null; then
    echo "  Homebrew 없음. 설치 중..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Apple Silicon PATH 즉시 적용
    eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
else
    echo "  OK ($(brew --version | head -1))"
fi

# ── 2. 의존 패키지 ────────────────────────────────────────────
echo ""
echo "[ 2/5 ] 패키지 설치..."
# fswatch, rsync: sync 데몬 필수
# webp: img2web (cwebp 명령어)
# imagemagick, ghostscript: pdf2img
# node: framer-sync 로컬 실행 + tsx + npm
# jq: JSON inspect (fsCtl, doc-coverage 등)
BREW_PKGS=(fswatch rsync webp imagemagick ghostscript tag node jq)
for pkg in "${BREW_PKGS[@]}"; do
    if brew list "$pkg" &>/dev/null; then
        printf "  [skip] %s (이미 설치됨)\n" "$pkg"
    else
        printf "  [설치] %s...\n" "$pkg"
        brew install "$pkg" 2>/dev/null || printf "  [경고] %s 설치 실패 — 나중에 수동 설치\n" "$pkg"
    fi
done
echo "  OK"

# ── 3. 스크립트 → ~/bin 복사 ──────────────────────────────────
echo ""
echo "[ 3/5 ] 스크립트 ~/bin 설치..."
mkdir -p "$BIN_DIR"

# setup.sh, install-scripts.sh, restore_quick_actions.sh 는 bin에 넣지 않음
EXCLUDE_SCRIPTS="setup.sh install-scripts.sh restore_quick_actions.sh"

while IFS= read -r -d '' script; do
    filename="$(basename "$script")"
    # 제외 목록 체크
    skip=0
    for excl in $EXCLUDE_SCRIPTS; do
        [ "$filename" = "$excl" ] && skip=1 && break
    done
    [ "$skip" -eq 1 ] && continue

    name="${filename%.*}"
    target="$BIN_DIR/$name"

    if [ -f "$target" ] && cmp -s "$script" "$target"; then
        printf "  [skip]   %s (최신)\n" "$name"
    else
        [ -L "$target" ] && rm "$target"
        cp "$script" "$target"
        chmod +x "$target"
        printf "  [설치]   %s\n" "$name"
    fi
done < <(find "$SCRIPTS_DIR" -maxdepth 1 -type f \
    \( -name "*.sh" -o -name "*.py" -o -name "*.rb" -o -name "*.js" \) \
    -print0)

# PATH 확인
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo "  ~/bin 이 PATH에 없음. ~/.zshrc 에 추가 중..."
    echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.zshrc"
    echo "  추가됨."
fi

# 터미널 시작 시 브리핑 등록
if ! grep -q "statusBriefing" "$HOME/.zshrc" 2>/dev/null; then
    cat >> "$HOME/.zshrc" << 'ZSHRC'

# ── 백그라운드 서비스 브리핑 ──────────────────────────────────
[ -x "$HOME/bin/statusBriefing" ] && "$HOME/bin/statusBriefing"
ZSHRC
    echo "  브리핑 ~/.zshrc 등록됨."
fi

# ── 4. Claude 메모리 symlink ──────────────────────────────────
echo ""
echo "[ 4/6 ] Claude 메모리 symlink 연결..."
CLAUDE_MEM_SRC="$SCRIPTS_DIR/memory"
CLAUDE_MEM_LINK="$HOME/.claude/projects/-Users-clavier/memory"
mkdir -p "$HOME/.claude/projects/-Users-clavier"
if [ -L "$CLAUDE_MEM_LINK" ]; then
    echo "  [skip] 이미 연결됨"
elif [ -d "$CLAUDE_MEM_LINK" ]; then
    echo "  [경고] 디렉토리 존재 — 수동 확인 필요: $CLAUDE_MEM_LINK"
else
    ln -s "$CLAUDE_MEM_SRC" "$CLAUDE_MEM_LINK"
    echo "  [연결] $CLAUDE_MEM_LINK → $CLAUDE_MEM_SRC"
fi

# ── 5. LaunchAgent 등록 ───────────────────────────────────────
echo ""
echo "[ 5/6 ] LaunchAgent 등록..."
mkdir -p "$HOME/Library/LaunchAgents"

if [ ! -d "$LAUNCHAGENTS_SRC" ]; then
    echo "  daemons 폴더 없음: $LAUNCHAGENTS_SRC"
else
    for plist in "$LAUNCHAGENTS_SRC"/*.plist; do
        [ -f "$plist" ] || continue
        filename="$(basename "$plist")"
        target="$HOME/Library/LaunchAgents/$filename"
        cp "$plist" "$target"
        launchctl unload "$target" 2>/dev/null || true
        launchctl load "$target"
        printf "  [등록] %s\n" "$filename"
    done
fi

# ── 5. FDA 권한 안내 ──────────────────────────────────────────
echo ""
echo "[ 6/6 ] 수동으로 해야 할 것"
echo ""
echo "  시스템 설정 → 개인 정보 보호 → 전체 디스크 접근 권한"
echo "  + 버튼 → Cmd+Shift+G 로 경로 직접 입력"
echo ""
echo "  추가 항목:"
echo "    /bin/bash"
echo "    /opt/homebrew/bin/rsync"
echo "    /opt/homebrew/bin/fswatch"
echo ""

# 시스템 설정 바로 열기
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || true

# ── 7. installScripts.sh — tools/*.mjs 자동 symlink (fsCtl 포함) ────────
echo ""
echo "[ 7/8 ] installScripts.sh 실행 (tools/ → ~/bin symlink + Doppler 설치) ..."
if [ -x "$SCRIPTS_DIR/installScripts.sh" ]; then
    bash "$SCRIPTS_DIR/installScripts.sh"
else
    echo "  ⚠️  installScripts.sh 없음 — 수동 설치 필요"
fi

# ── 8. framer-sync npm install ─────────────────────────────────────────
echo ""
echo "[ 8/9 ] framer-sync 의존성 설치 (Mac 로컬 Node 실행에 필요) ..."
FRAMER_SYNC_DIR="$(dirname "$SCRIPTS_DIR")/code/projects/platform-workers/framer-sync"
if [ -d "$FRAMER_SYNC_DIR" ]; then
    if [ -d "$FRAMER_SYNC_DIR/node_modules" ]; then
        echo "  [skip] node_modules 이미 있음"
    else
        echo "  [설치] $FRAMER_SYNC_DIR (수 분 소요 — better-sqlite3 native compile)"
        (cd "$FRAMER_SYNC_DIR" && npm install 2>&1 | tail -5) || echo "  ⚠️  npm install 실패 — 수동 재시도 필요"
    fi
else
    echo "  ⚠️  framer-sync 폴더 없음: $FRAMER_SYNC_DIR"
    echo "      iCloud 동기화가 끝났는지 확인하거나, GitHub 에서 직접 clone:"
    echo "      git clone https://github.com/clavier0/platform-workers \"$(dirname "$FRAMER_SYNC_DIR" | sed 's|/projects$||')\""
fi

# ── 9. Claude routines (Tier 3) — slash command + 등록 trigger ─────────
# bash 에서 MCP 호출 불가하므로 Claude 세션 안에서 /registerRoutines 으로 분리 실행.
echo ""
echo "[ 9/9 ] Claude routines (Tier 3) trigger 준비..."
SLASH_CMD_SRC="$SCRIPTS_DIR/tools/registerRoutines.md"
SLASH_CMD_DIR="$HOME/.claude/commands"
SLASH_CMD_LINK="$SLASH_CMD_DIR/registerRoutines.md"
if [ -f "$SLASH_CMD_SRC" ]; then
    mkdir -p "$SLASH_CMD_DIR"
    if [ ! -L "$SLASH_CMD_LINK" ] || [ "$(readlink "$SLASH_CMD_LINK")" != "$SLASH_CMD_SRC" ]; then
        ln -sf "$SLASH_CMD_SRC" "$SLASH_CMD_LINK"
        echo "  [slash] ~/.claude/commands/registerRoutines.md → $SLASH_CMD_SRC"
    else
        echo "  [skip] slash command 이미 연결됨"
    fi
    mkdir -p "$HOME/.clavier"
    : > "$HOME/.clavier/routines-pending"
    echo "  [marker] ~/.clavier/routines-pending 박음 (다음 Claude 세션이 자동 권유)"
else
    echo "  ⚠️  $SLASH_CMD_SRC 없음 — Tier 3 등록 수동 필요"
fi

echo ""
echo "======================================"
echo "  완료"
echo ""
echo "  등록된 LaunchAgents (Tier 2):"
launchctl list | awk '/com\.clavier\./ {printf "    %s (pid %s)\n", $3, $1}' 2>/dev/null || true
echo ""
echo "  남은 1발 (Tier 3 — Claude routines):"
echo "    1. Claude Code 세션 띄움 (clavier-scripts 디렉토리에서 권장)"
echo "    2. /registerRoutines  실행 → 5 routines 일괄 등록"
echo ""
echo "  검증:"
echo "    launchctl list | grep clavier   # Tier 2 (macOS)"
echo "    Claude 세션 안에서 /scheduled-tasks list   # Tier 3"
echo "======================================"
