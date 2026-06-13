---
name: brand-tone-architecture
description: >-
  브랜드 사진의 톤을 형성하기 위한 *아키텍쳐*를 짜는 스킬. 행위가 아니라 이 맥락이 본질이다.
  사용자가 "캡쳐원 스타일 만들어", "costyle/스타일 셋 짜줘", "브랜드 사진 톤 LUT/스타일
  아키텍쳐", "레퍼런스(앨범/사진셋)에서 톤 리버스 엔지니어링", "base LUT + 레이어 LUT 세트",
  "내 보정값을 레이어로 분리", "mukayu 톤으로 스타일셋", "사진들 기반으로 룩 만들어",
  "그레이딩 아키텍쳐", "캡쳐원 레이어 스타일" 같은 말을 하면 이 스킬을 적용. 시네마 컬러리스트
  + 사진 프리셋 업계의 *레이어형 그레이딩 아키텍쳐*(technical→balance→contrast→look→trim)를
  Capture One `.costyle` 세트와 `.cube` LUT 으로 구현한다. reuse-first: 기존 photo-lut.py
  (사진→.cube 역추출)·lut.mjs(.cube 적용)를 먼저 조합.
---

# brand-tone-architecture — 브랜드 사진 톤 아키텍쳐

## 근원 맥락 (절대 잊지 말 것)

이 스킬의 본질은 **"브랜드 사진 톤을 형성하기 위한 아키텍쳐"** 이고, 개별 행위(생성/리버스/분리)는
그 맥락의 *수단*이다. 사용자(2026-06-13)의 말: *"가장 중요한 건 행위가 아니라 근원의 맥락에 있어.
그 맥락을 잊지 않고 계속 업데이트해나가며 발전시키고 싶어."* → 이 스킬은 계속 자라는 살아있는 문서다.
관련 메모리: `memory/project_brand_tone_architecture.md`.

우산 아래 수단들 (전부 같은 맥락):
1. **리버스 엔지니어링** — 레퍼런스 앨범/사진셋에서 *어떤 LUT·스타일 아키텍쳐로 톤을 잡았는지* 분석.
2. **아키텍쳐 구현** — 분석한 구조를 `.costyle` 세트 + `.cube` LUT 으로 직접 구현.
3. **값→레이어 분리** — 사용자가 만든 보정값을 *체계적 레이어*로 분리 (BASE 컬러 / mood 변주 / trim).

## 세 개의 레퍼런스 (먼저 읽어라)

- **`references/grading-architecture.md`** — 업계 베스트프랙티스. 정전 스테이지 순서
  (technical→balance→contrast→look→secondaries→trim), 극단+opacity 트림, ASC CDL,
  필름 프린트 에뮬, Base+Variant 프리셋 패턴, 하지 말 것. *세트를 설계할 때 이걸 기준으로.*
- **`references/authoritative-samples.md`** — 공신력 최고 실물 = Capture One 번들 39개 공식 스타일
  (앱 안 정규 경로, 복사 안 하고 직접 읽음). per-category 해부 = 프로가 책임을 어떻게 *분리*하는가.
  핵심: 벤더 스타일은 평면 단일목적, 레이어는 *적용 시점*에 쌓음.
- **`references/costyle-format.md`** — 검증된 `.costyle` 키 사전. **emit 하는 모든 키는 여기 또는
  실물 export/벤더 샘플에서 관측된 것만** (추측 금지). 구조·키·값포맷·저장위치.

## 핵심 설계 원칙

1. **단일 LUT 금지 — 순서 있는 독립 트림 레이어.** BASE_Core(컬러 DNA) / mood 변주(HDR·contrast) /
   Util(clarity·sharpen·vignette·grain). 각 레이어 한 책임 + 독립 opacity.
2. **극단 제작 + Opacity 조절.** 각 룩 레이어를 컨셉의 극단으로 만들고 적용 시 opacity 로 트림 (AlexOnRAW 등 업계 표준).
3. **변주축은 브랜드 데이터가 결정.** indoor/outdoor 같은 가정을 박지 말 것 — 사진 분석이 실제 축을 말한다
   (mukayu 는 indoor/outdoor 가 아니라 dark-mood / bright-product 였음).
4. **키 추측 금지.** `gh api search/code "<key> extension:costyle"` 로 hit 확인 또는 실물 export.
5. **슬라이더형 costyle > ICC/fcrv 사이드카** (포터블·편집가능).
6. **자동 역산의 한계를 정직하게.** 이미 그레이딩된 내용-다양 출력에서 절대 색/톤은 underdetermined
   (피사체색 오염). *상대 split-tone* 만 안정 추출, 나머지는 콜로리스트 눈 또는 충실한 .cube 복제로.

## 도구 (front door + 기존 바퀴)

- **`costyle <verb>`** (`tools/costyle.py`, door:image) — 이 스킬의 실행 진입부:
  - `costyle make [preset] [--out DIR]` — 레이어 호환 스타일 세트 생성 (기본 preset=mukayu → CO Styles).
    writer 가 **배경 전용 키(WB 등)를 구조적으로 거부** → WB 드롭 실수 재발 불가.
  - `costyle reverse <photodir> [-o c]` — 사진셋 → `.cube` (photo-lut 위임).
  - `costyle split <src.costyle>` — 레이어 스타일 1개 → 컬러/HDR/trim 책임별 분리 파일.
  - `costyle keys [<key>]` — 검증된 키 사전 / 배경전용 경고 (추측 금지).
- `tools/lib/clip_embed.py` — open_clip 임베딩·zero-shot·kmeans 공유 바퀴 (로컬·무료·MPS).
- `img tag <dir> --clip` / `img cluster <dir> --clip` — CLIP 백엔드 = 비전 API 없이 무료 태깅·그루핑.
- `tools/photo-lut.py` — 사진 → `.cube` 역추출 (톤구간 LAB). `tools/lut.mjs` — `.cube` 적용(ffmpeg).

## 진행 상태 / 로드맵 (메모리 — 다음 세션이 여기서 이어받음)

**✅ 검증·완료 (2026-06-13)**:
- CO 라이브 검증: Engine 1300 레이어형 → 조정 레이어로 정확 적용 (HDR -90/85/-100/-95 클램프 없이).
  WhiteBalance 는 레이어 드롭 = 배경 전용 → `costyle.py` writer 가 구조적 차단. 상세 = `costyle-format.md` ★.
- `costyle` 도구 정식화 (make/reverse/split/keys). mukayu 세트 = `costyle make mukayu` 로 생성 (CO Styles, WB 없는 레이어 호환만).
- CLIP 백엔드 (`clip_embed.py` + `img tag/cluster --clip`) — mukayu 115장 zero-shot 태깅(Finder+XMP) + 의미 8군집 검증.
- 전부 GitHub main 머지 (PR #141·142·143 + costyle PR).

**다음 후보 (아직)**:
- `costyle make` 에 preset 추가 (mukayu 외 다른 브랜드) — `reverse`(.cube) ↔ `split`(분리) ↔ `make`(세트) 사슬 연결.
- `costyle reverse` → 사진셋에서 *상대 split-tone* 만 뽑아 BASE preset 자동 제안 (절대값 underdetermined 한계 명시).
- 평면(flat) 스타일 writer (WB 포함 배포용) 가 필요해지면 그때. 지금은 레이어형만.
- `references/examples/mukayu_reverse_demo.py` = 사진→시그니처→costyle 매핑 worked example (photo-lut 재사용).
