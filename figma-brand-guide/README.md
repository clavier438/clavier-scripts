# Brand Guide 생성 — Figma 플러그인

webExporter + image-tagger 분석 결과(`~/Pictures/imageRefs/<brand>/`)를 받아 **Figma 캔버스에 브랜드 스탠다드를 실제 노드로 생성**한다. HTML 재현이 아니라 편집 가능한 Figma 프레임.

> Figma 캔버스 쓰기는 **플러그인 API만** 가능(REST/MCP는 읽기 전용·design-bridge는 Framer용). 그래서 플러그인.
> 이미지는 UI에서 **webp→png 변환** 후 전달 — `figma.createImage`는 png/jpg/gif만 지원하기 때문.

## 입력 (분석 폴더 안)
- `_tags.json` — 사진별 4축(피사체·톤·후보정·구도) + 지배색 hex
- `_palette/*.json` — 브랜드 렌더 컬러 (webExporter `--extract-colors`)
- `*.webp` — 사진들
- `_fonts/_loaded.txt` — 로드 서체 (선택)
- `_assets/*.svg` — SVG 에셋 (선택, 개수만 집계)

## 생성 모듈 (Straightforward/Redo 템플릿 결)
Cover(그라디언트+nav) · 01 Color(브랜드+사진 지배색 칩) · 02 Photography(톤 분포 바 + 톤별 이미지 그리드 + 후보정/피사체) · 03 Typography(서체) · 04 Assets

## 사용법
1. Figma 데스크탑 → **Plugins → Development → Import plugin from manifest…** → 이 폴더 `manifest.json` (최초 1회)
2. **Plugins → Development → Brand Guide 생성**
3. 브랜드명·URL 입력 → **분석 폴더 선택**(예 `~/Pictures/imageRefs/theslow`, 폴더 통째) → **Figma에 생성**
4. 캔버스에 가이드 프레임 생성 + 자동 줌

## 한계 / TODO
- 폰트는 Inter 고정(로드 보장). 브랜드 서체 임베드는 추후.
- 카피(essence/insight)는 분포에서 자동 생성 예정(현재 일반 문구).
- 사이드바 nav는 커버에만. 섹션 점프는 추후.
- Figma 밖에서 실행 불가 → 문법만 검증됨. 첫 실행 오류는 보고→수정.
