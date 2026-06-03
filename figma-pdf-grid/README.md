# PDF Grid — webExporter PDF → Figma 그리드 배치

webExporter 가 만든 사이트 PDF를 **페이지별 PNG로 펼쳐 Figma 캔버스에 그리드로 자동 배치**하는 Figma 플러그인 + 분해 스크립트.

> Figma는 REST API로 캔버스에 그림을 못 그린다(읽기 전용). 캔버스 쓰기는 **플러그인 API**가 유일한 길 — `figma.createImage(bytes)` → `rectangle.fills[IMAGE]`.

## 흐름 (2단계)

### 1. PDF → 페이지별 PNG (Mac)

```bash
./pdf2png.sh ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/works/study/books/satoyama-jujo.com/satoyama-jujo.com.pdf
# → satoyama-jujo.com.pdf_pages/ 에 satoyama-jujo.com_page-01.png … 생성
```

옵션: `./pdf2png.sh <pdf> [출력폴더] [DPI=120]` — DPI 높이면 더 선명(파일 큼).

### 2. Figma 플러그인으로 그리드 배치

1. Figma 데스크탑 → **Plugins → Development → Import plugin from manifest…** → 이 폴더의 `manifest.json` 선택 (최초 1회)
2. **Plugins → Development → PDF Grid 배치** 실행
3. 1단계에서 만든 PNG들 선택 → 열 수 / 간격 / 최대폭 지정 → **그리드 배치**
4. 페이지들이 그리드로 펼쳐지고 하나의 그룹으로 묶임 + 화면 자동 이동

## 옵션

| 항목 | 기본 | 설명 |
|---|---|---|
| 열 수 | 5 | 그리드 가로 칸 수 |
| 간격 | 40px | 이미지 사이 여백 |
| 최대폭 | 800px | 이미지 가로 상한 (비율 유지 축소, 0=원본) |

## 파일

| 파일 | 역할 |
|---|---|
| `manifest.json` | Figma 플러그인 정의 (개발 모드 import 대상) |
| `code.js` | 그리드 배치 로직 (createImage → rectangle fill → N열 좌표 → group) |
| `ui.html` | 파일 선택 + 옵션 UI (bytes → postMessage) |
| `pdf2png.sh` | PDF → 페이지별 PNG (pdftoppm/poppler) |

## 요구

- macOS: `brew install poppler` (pdftoppm) — 확인됨 ✓
- Figma 데스크탑 앱 (플러그인 개발 모드)

## webExporter 패밀리에서의 위치

웹 종합 맥가이버 칼의 **출력 후처리** 갈래:
- `webExporter` (playwright) — 캡처(PDF) + 이미지 + 폰트 + 컬러
- `tools/site-scraper` (requests) — 텍스트 + 데이터
- **`figma-pdf-grid`** — 캡처 PDF → Figma 레퍼런스 보드(그리드)
