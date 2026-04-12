#!/usr/bin/env bash
# installScripts.sh — iCloud/0/scripts/ 의 스크립트를 ~/bin 에 복사
# - 루트 스크립트 → ~/bin/
# - daemons/ 스크립트 → ~/bin/daemons/
# watcherScripts LaunchAgent 가 변경 감지 시 자동 실행 / 직접 실행도 가능
#
# 사용법: installScripts [bin_dir]
#   bin_dir: 설치 루트 디렉터리 (기본값: ~/bin)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${1:-$HOME/bin}"
DAEMONS_BIN_DIR="$BIN_DIR/daemons"

mkdir -p "$BIN_DIR"
mkdir -p "$DAEMONS_BIN_DIR"

install_scripts() {
    local src_dir="$1"
    local dst_dir="$2"
    local count=0
    local updated=0

    while IFS= read -r -d '' script; do
        local filename
        filename="$(basename "$script")"
        local name="${filename%.*}"
        local target="$dst_dir/$name"

        if [ -f "$target" ] && [ ! -L "$target" ]; then
            if cmp -s "$script" "$target"; then
                echo "  [skip]   $name  (이미 최신)"
                continue
            fi
            cp "$script" "$target"
            chmod +x "$target"
            echo "  [update] $name"
            ((updated++))
        else
            [ -L "$target" ] && rm "$target"
            cp "$script" "$target"
            chmod +x "$target"
            echo "  [new]    $name"
            ((count++))
        fi
    done < <(find "$src_dir" -maxdepth 1 -type f \
        \( -name "*.sh" -o -name "*.py" -o -name "*.rb" -o -name "*.js" \) \
        -print0)

    echo "  완료: 신규 ${count}개, 업데이트 ${updated}개"
}

echo "스크립트 설치 위치: $BIN_DIR"
echo "원본 디렉터리:      $SCRIPT_DIR"
echo ""

echo "[ scripts → ~/bin ]"
install_scripts "$SCRIPT_DIR" "$BIN_DIR"

echo ""
echo "[ daemons → ~/bin/daemons ]"
install_scripts "$SCRIPT_DIR/daemons" "$DAEMONS_BIN_DIR"

# PATH에 bin_dir이 없으면 안내
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo "⚠️  '$BIN_DIR' 가 PATH에 없습니다."
    echo "   아래 줄을 ~/.zshrc 에 추가하세요:"
    echo ""
    echo "   export PATH=\"\$HOME/bin:\$PATH\""
    echo ""
    echo "   추가 후: source ~/.zshrc"
fi
