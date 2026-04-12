#!/bin/bash
# ============================================================
# Website JPG Exporter — Shell Wrapper
# 사용법: ./webPdfExporter.sh https://example.com
# 옵션:   ./webPdfExporter.sh https://example.com -o ./output -m 50 -s 15
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Website Exporter${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

if [ -z "$1" ]; then
    echo -e "${RED}[ERROR] URL을 입력하세요${NC}"
    echo "사용법: ./webPdfExporter.sh https://example.com"
    echo "옵션:   ./webPdfExporter.sh https://example.com -o ./output -m 50 -s 15"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 의존성 확인 ────────────────────────────────────────────
echo -e "${YELLOW}[1/3] 의존성 확인 중...${NC}"

if ! command -v python3 &>/dev/null; then
    echo -e "${RED}[ERROR] python3이 설치되어 있지 않습니다${NC}"
    exit 1
fi

if ! python3 -c "import playwright" 2>/dev/null; then
    echo "  → playwright 설치 중..."
    pip3 install playwright --break-system-packages --quiet
fi

if ! python3 -c "from PIL import Image" 2>/dev/null; then
    echo "  → Pillow 설치 중..."
    pip3 install Pillow --break-system-packages --quiet
fi

if ! python3 -c "
from playwright.sync_api import sync_playwright
p=sync_playwright().start(); p.chromium.executable_path; p.stop()
" 2>/dev/null; then
    echo "  → Chromium 설치 중..."
    python3 -m playwright install chromium
fi

WEB2PDF_BIN="$SCRIPT_DIR/web2pdf/.build/release/web2pdf"
if [ ! -f "$WEB2PDF_BIN" ]; then
    echo "  → web2pdf 빌드 중..."
    (cd "$SCRIPT_DIR/web2pdf" && swift build -c release --quiet 2>&1)
fi

echo -e "${GREEN}  → 의존성 준비 완료${NC}"

# ── Python 실행 ────────────────────────────────────────────
echo -e "${YELLOW}[2/3] 익스포트 시작...${NC}"
echo ""

python3 "$SCRIPT_DIR/webPdfExporter.py" "$@"
EXIT_CODE=$?

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} [3/3] 완료!${NC}"
echo -e "${GREEN}========================================${NC}"
exit $EXIT_CODE
