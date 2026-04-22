#!/usr/bin/env bash
# setup.sh — 포맷 후 전체 환경 복구 스크립트
# 실행: bash ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/0/scripts/setup.sh

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHAGENTS_SRC="$(dirname "$SCRIPTS_DIR")/launchagents"
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
BREW_PKGS=(fswatch rsync webp imagemagick ghostscript tag)
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
    echo "  launchagents 폴더 없음: $LAUNCHAGENTS_SRC"
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

echo ""
echo "======================================"
echo "  완료"
echo ""
echo "  등록된 서비스:"
echo "    syncObsidian      — Obsidian → Google Drive 실시간 sync"
echo "    syncScriptable    — Scriptable → Google Drive 실시간 sync"
echo "    watcherSync       — 데몬 1시간마다 감시/자동재시작"
echo "    watcherScreenshots — 스크린샷 → Photos 자동 가져오기"
echo ""
echo "  FDA 설정 후 동작 확인:"
echo "    launchctl list | grep clavier"
echo "    syncObsidian status"
echo "    syncScriptable status"
echo "    cat ~/Library/Logs/watcherSync.log"
echo "======================================"
