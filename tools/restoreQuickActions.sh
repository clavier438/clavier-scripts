#!/bin/bash
# Mac Quick Actions & Scripts 복구 스크립트
# 포맷 후 이 스크립트를 실행하면 Quick Action과 커스텀 스크립트가 복구됩니다.
#
# 사용법:
#   1. Google Drive 동기화 완료 후
#   2. 터미널에서 실행:
#      bash ~/Library/CloudStorage/GoogleDrive-*/My\ Drive/scripts/restore_quick_actions.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== Mac Quick Actions & Scripts 복구 시작 ==="

# 1. ~/bin 폴더 생성 및 스크립트 복사
echo "[1/6] ~/bin 폴더 설정 중..."
mkdir -p ~/bin

# Google Drive scripts 폴더의 모든 .sh 파일을 ~/bin에 복사
for script in "$SCRIPT_DIR"/*.sh; do
    if [[ -f "$script" && "$(basename "$script")" != "restore_quick_actions.sh" ]]; then
        script_name=$(basename "$script" .sh)
        cp "$script" ~/bin/"$script_name"
        chmod +x ~/bin/"$script_name"
        echo "      -> ~/bin/$script_name 완료"
    fi
done

# 2. PATH에 ~/bin 추가 (.zshrc)
echo "[2/6] PATH 설정 확인 중..."
ZSHRC=~/.zshrc
PATH_LINE='export PATH="$HOME/bin:$PATH"'

if [[ -f "$ZSHRC" ]]; then
    if ! grep -q 'HOME/bin' "$ZSHRC"; then
        echo "" >> "$ZSHRC"
        echo "# Custom scripts path" >> "$ZSHRC"
        echo "$PATH_LINE" >> "$ZSHRC"
        echo "      -> ~/.zshrc에 PATH 추가됨"
    else
        echo "      -> PATH 이미 설정됨"
    fi
else
    echo "# Custom scripts path" > "$ZSHRC"
    echo "$PATH_LINE" >> "$ZSHRC"
    echo "      -> ~/.zshrc 생성 및 PATH 추가됨"
fi

# 3. Services 폴더 생성
echo "[3/6] Services 폴더 확인 중..."
mkdir -p ~/Library/Services

# 4. Quick Action workflow 복사
echo "[4/6] Quick Action workflow 복사 중..."
for workflow in "$SCRIPT_DIR"/*.workflow; do
    if [[ -d "$workflow" ]]; then
        workflow_name=$(basename "$workflow")
        cp -R "$workflow" ~/Library/Services/
        echo "      -> $workflow_name 완료"
    fi
done

# 5. Droplet 앱 복사
echo "[5/6] Droplet 앱 복사 중..."
for app in "$SCRIPT_DIR"/*.app; do
    if [[ -d "$app" ]]; then
        app_name=$(basename "$app")
        cp -R "$app" /Applications/
        echo "      -> /Applications/$app_name 완료"
    fi
done

# 6. 서비스 캐시 새로고침
echo "[6/6] 서비스 캐시 새로고침 중..."
/System/Library/CoreServices/pbs -update 2>/dev/null || true

echo ""
echo "=== 복구 완료! ==="
echo ""
echo "터미널에서 사용 가능한 명령어:"
for script in ~/bin/*; do
    if [[ -f "$script" && -x "$script" ]]; then
        echo "  - $(basename "$script")"
    fi
done
echo ""
echo "Quick Actions (Finder 우클릭):"
for workflow in ~/Library/Services/*.workflow; do
    if [[ -d "$workflow" ]]; then
        echo "  - $(basename "$workflow" .workflow)"
    fi
done
echo ""
echo "Droplet 앱 (Dock에 드래그해서 사용):"
for app in /Applications/*.app; do
    app_name=$(basename "$app" .app)
    if [[ -f "$SCRIPT_DIR/$app_name.app/Contents/Info.plist" ]]; then
        echo "  - $app_name"
    fi
done
echo ""
echo "새 터미널을 열거나 'source ~/.zshrc' 실행하세요."
