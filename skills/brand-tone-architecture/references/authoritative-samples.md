# 공신력 있는 실제 `.costyle` 샘플 — Capture One 벤더 번들 (해부)

> 가장 공신력 있는 레퍼런스 = **Capture One 이 직접 만들어 앱에 번들한 39개 공식 스타일**.
> repo 에 복사하지 않는다 (벤더 독점 = 재배포 금지 + CO 업데이트 시 stale). 대신 **정규 경로에서 직접 읽는다** —
> 모든 CO 설치에 항상 존재. 2026-06-13 Capture One.app 에서 해부.

## 위치 (Mac, 모든 CO 설치 공통)

```bash
CO="/Applications/Capture One.app/Contents/Resources"
find "$CO/Styles" -iname "*.costyle"          # Base Edits / Creative Edits / Film & Cine / B&W (14개)
find "$CO/Packages" -iname "*.costyle"        # CulturalHeritage 필름스캔 에뮬 (Portra/Fujicolor 등, 25개)
cat "$CO/Styles/Creative Edits/Airy Summer.costyle"   # 실물 1개 보기
```

## ★ 최대 인사이트 — 벤더 스타일은 *평면(flat)*, 레이어는 *적용 시점*에

CO 공식 스타일은 전부 **단일 `<SL>` 블록 (LDS/레이어 없음)**, Engine 800~1100. 즉 Capture One 의 제품 설계 =
**단일목적 스타일을 따로따로 배포하고, 사용자가 adjustment layer 에 *쌓아서* 룩을 조립.** 폴더 분류(Base/Creative/Film)가
곧 레이어 아키텍쳐다. → 우리가 가르치는 base+variant+trim 레이어링이 *벤더 제품에서 그대로 증명됨*.

(참고: 사용자가 *레이어 보정에서* 스타일을 저장하면 CO 가 Engine 1300 의 `<LDS><LD><LA>` 형태로 export — `costyle-format.md` 구조.
배포용 평면 ↔ 레이어형 둘 다 유효. 새로 만들 땐 1300 레이어형 권장.)

## per-category 해부 — 프로가 책임을 어떻게 *분리*하는가

| 카테고리 | 만지는 키 | 안 만지는 것 | 역할 |
|---|---|---|---|
| **Base Edits** (Clear/Flat/Bright Contrast) | `Contrast`·`Clarity`·`ClarityStructure`·`HighlightRecoveryEx`·`ShadowRecovery`·`Saturation` | **컬러 틴트 없음** (ColorBalance X) | 순수 톤/대비 토대 |
| **Creative Edits** (Airy Summer, Cozy Fall…) | `ColorBalance`+3-way·`ColorCorrections`·완만한 `GradationCurveY`·약한 HDR | 강한 그레인 없음 | 컬러 무드(룩) |
| **Film & Cine** (Cinema Warm/Cool, K100/F400) | 위 컬러 전부 + `FilmGrainAmount/Type/Granularity`·`ClarityMethod`·다점 `GradationCurveY` | — | 풀 룩 + 필름 질감 |
| **Black & White** (B&W Soft/Punch) | `BwEnabled`+`BwRed/Green/Blue/Cyan/Magenta/Yellow`(채널믹서)·`Contrast`·`Brightness`·`GradationCurve` | 컬러밸런스 | 흑백 변환 |
| **Film Scanning** (Kodak Portra 160NC, Fujicolor Pro 160S…) | 필름스톡별 ColorCorrections + 커브 | — | 스캔 필름 에뮬(고공신력) |

핵심 교훈 = **Base Edits 가 컬러를 *전혀* 안 건드린다** (톤만). Creative 가 컬러만. 이 깔끔한 책임 분리가
우리 BASE(컬러 DNA) / mood(HDR) / Util(trim) 레이어 설계의 벤더 근거. (단 벤더는 BASE=톤, 우리 BASE=컬러로
명명이 반대 — 본질은 "한 스타일 = 한 책임" 동일.)

## 실측으로 추가 확정된 키 (costyle-format.md 보강)

- `ColorBalance` — 마스터 4번째 휠. `R;G;B` 배율 (3-way 와 별개·동시 존재).
- `Contrast`·`Saturation`·`Brightness` — 단일 float.
- `ClarityMethod` — 관측값 1·2·3 모두 유효 (Natural/Punch/Neutral/Classic 중).
- `StyleSource` V="Styles" — 배포 스타일 메타.
- B&W: `BwEnabled`·`BwRed`·`BwGreen`·`BwBlue`·`BwCyan`·`BwMagenta`·`BwYellow`.

## 2차 레퍼런스 (취미~준프로, GitHub 코퍼스)

`gh api search/code "extension:costyle"` ≈ 616개. 컬렉션: `lolochristen/CaptureOne_FilmStyles`
(Agfa/Fuji/Ilford/Kodak/Polaroid 필름 에뮬). 벤더 번들보다 공신력 낮음 — 키 hit 수 확인용·아이디어용.
