---
name: figma-grid-autoplace
description: >-
  Place a set of images (webExporter PDF pages, captured site sections, any
  image folder) onto a Figma canvas as an auto-arranged grid — for building
  reference / analysis boards. Use whenever the user wants to put PDFs or images
  into Figma as a grid, lay out captured sections in Figma for visual analysis,
  or run the figma-pdf-grid plugin. Korean triggers: 피그마 그리드, 피그마에 올려,
  분석 보드, 레퍼런스 보드 만들어, figma 자동 배치, pdf 피그마에 올려, 그리드로
  펼쳐. English: figma grid board, place images in figma, reference board,
  figma-pdf-grid plugin, auto-place images on canvas.
---

# Figma Grid Auto-place — PDF/이미지 → Figma 캔버스 그리드

캡처한 이미지들(webExporter PDF 페이지, 사이트 섹션 등)을 Figma 캔버스에 N열 그리드로 자동 배치해 **레퍼런스/분석 보드**를 만든다. 사용자 손은 "플러그인에서 클릭 1번"까지 줄인다.

## 핵심 사실 — 먼저 알 것 (헛수고 방지)

레퍼런스 클래스로 확인된 현실(2026 기준):
- **Figma REST API = 캔버스 쓰기 불가** (읽기 + 댓글/변수만).
- **Figma MCP write-to-canvas(`use_figma`) = 이미지 미지원.** docs 명시: "No assets (image) support yet". 프레임·컴포넌트·오토레이아웃만 씀. (이미지 지원은 추가 작업 중이나 아직 없음.)
- → **Figma에 이미지 배치 = 플러그인 `createImage`/`createImageAsync` 가 유일 경로.** 그게 `clavier-scripts/figma-pdf-grid` 플러그인이다.
- Figma가 이미지 write 를 정식 지원하면 그때 MCP 로 완전 자동 전환. 그 전엔 이 플러그인이 정답 — *MCP로 직접 배치 시도하다 시간 버리지 말 것.*

## 자동화 흐름 (3단계)

### 1. 소스 → webp 분해
```bash
magick -density 60 "input.pdf" -resize 'x16000>' -quality 50 -define webp:method=6 "OUT/name_p%d.webp"
```
- **webp 최대 16383px** — 긴 페이지는 `-resize 'x16000>'` 로 높이 캡 **필수**. 안 하면 `width or height exceeds limit` 에러로 일부 페이지가 안 나온다.
- density 80은 긴 페이지에서 limit 초과 잦음 → **60 권장**.
- 임시·분석용이면 webp + quality 50 → PNG 대비 ~19배 작다(예: PNG 17.7MB → webp 0.9MB). 보정 안 할 거면 화질보다 용량.

### 2. 로컬 CORS 서버
```bash
clavier-scripts/figma-pdf-grid/pdf-grid-serve.sh <webp폴더> [포트=8787]
```
- 폴더의 webp/png/jpg → `index.json`(파일명 배열) 생성 + **CORS 헤더** 정적 서버(Python).
- CORS 필수 — 플러그인 iframe 이 `index.json` 을 fetch 하고 `createImageAsync` 로 각 이미지를 불러오기 때문.
- 포트를 바꾸면 `figma-pdf-grid/manifest.json` 의 `networkAccess.devAllowedDomains` 도 같이 바꿀 것.

### 3. Figma 플러그인 (figma-pdf-grid) — 사용자 클릭
1. (최초 1회) Figma 데스크탑 → Plugins → Development → **Import plugin from manifest** → `figma-pdf-grid/manifest.json`.
2. Plugins → Development → **PDF Grid 배치** 실행 → **"서버에서 자동 배치"** 클릭.
3. index.json 의 이미지들이 N열 그리드로 배치 + 그룹화 + 화면 이동.
- 두 모드: ① URL 자동로드(서버, 파일선택 생략) ② 파일 직접 선택(fallback).
- 플러그인 코드를 바꾸면 재import 또는 재실행해야 반영된다.

## 도구 위치
| 파일 | 역할 |
|---|---|
| `figma-pdf-grid/code.js` | `createImage(bytes)` / `createImageAsync(url)` → rectangle IMAGE fill → N열 그리드 → group |
| `figma-pdf-grid/manifest.json` | `networkAccess.devAllowedDomains: ["http://localhost:8787"]` |
| `figma-pdf-grid/ui.html` | "서버에서 자동 배치"(index.json fetch) + 파일 선택 UI |
| `figma-pdf-grid/pdf-grid-serve.sh` | 이미지 폴더 → index.json + CORS 정적 서버 |
| `figma-pdf-grid/pdf2png.sh` | (대안) PDF → 페이지별 PNG (pdftoppm). webp 가 더 가벼움. |

## 검증된 사례
아만(amandayan) 6섹션 → webp 12장(density 60, 13MB) → `pdf-grid-serve.sh /tmp/amandayan_webp` → 플러그인 "서버에서 자동 배치" → 그리드 완성.

## reference
- Figma write-to-canvas (이미지 미지원 확인): https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/
- createImageAsync + networkAccess: https://developers.figma.com/docs/plugins/making-network-requests/
- createImage / Image.getSizeAsync: https://www.figma.com/plugin-docs/api/properties/figma-createimage/
