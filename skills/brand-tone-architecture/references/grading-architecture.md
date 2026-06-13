# 브랜드 사진 톤 — 그레이딩/스타일 세트 아키텍쳐 (업계 베스트프랙티스)

> 2026-06-13 스터디. 시네마 컬러리스트 + 사진 프리셋 업계 합의. costyle/.cube 세트 설계의 근거.
> 출처는 문서 끝 Sources.

## 한 줄 결론

**룩을 하나의 모놀리식 LUT에 굽지 말고, *순서가 있는 독립 트림 레이어*로 쪼갠다.** 시네마 그레이딩(DaVinci 노드)과 사진 프리셋(Mastin/RNI)이 *같은* 아키텍쳐로 수렴한다. 각 레이어 = 한 책임 + 독립 강도(opacity/gain) 조절.

## 정전(canonical) 스테이지 순서 — 직렬 레이어

| # | 스테이지 | 하는 일 | 왜 이 순서 |
|---|---|---|---|
| 1 | **Technical / Normalize (베이스)** | log→display, 색공간 변환. 스타일 아님, 정밀도. | 크리에이티브 레이어는 *정규화된* 이미지를 전제. 반드시 맨 앞. |
| 2 | **Balance** | 중립 노출 + WB 토대. gamma linear 로 클린 밸런스. | 표준화돼야 룩이 이미지 간 *복사*됨. |
| 3 | **Contrast / Tone shaping** | 톤 커브·콘트라스트 비율. | 룩 전에 톤 구조 확정. |
| 4 | **Creative Look** | 브랜드 아이덴티티: split-toning, 컬러 팔레트, 웜. *전역*. | 밸런스 후 적용해야 예측 가능하게 안착("technical-before-creative" 철칙). |
| 5 | **Secondaries / Localized** | 스킨·특정색·마스크 (선택). | 룩 다음 국소 보정. |
| 6 | **Trim / Finish** | vignette, grain, sharpen, NR. *항상 마지막, 약하게*. | 마무리 질감. |

(Juan Melara 프로 노드트리: Balance → Localized Exposure → Localized Color → Look → Final("adjustable LUT"). 같은 골격.)

## 레이어 강도 = 컨트롤 표면

- 각 룩 레이어를 **강하게(타깃까지) 만들고 opacity/output-gain 으로 트림**. AlexOnRAW: "스타일을 강하게 만들고, opacity 20~30% 로 떨궈 적응시켜라." → 우리의 *극단 제작 + Opacity 조절* 워크플로의 업계 근거.
- 마지막 Final 노드를 모든 클립에 *동일하게* 유지 = 그레이드 통일성("adjustable LUT").

## ASC CDL — 이식 가능한 1차 보정 문법

`Slope`(gain/contrast) · `Offset`(lift) · `Power`(gamma) · `Saturation`. 채널별. 장비/소프트 간 1차 그레이드 *교환 표준*.
→ Capture One 매핑: Slope≈Exposure/Levels, Offset≈Brightness, Power≈Curve gamma, 톤구간 틴트≈ColorBalance 3-way.

## 필름 프린트 에뮬레이션 패턴

프린트-에뮬 LUT 은 *모니터/디스플레이 레벨*에 얹히고 — 보정·그레이드는 그 *아래*에 깔리며, 출력 직전 LUT 제거. 즉 "룩"은 그 밑에서 그레이딩하는 *비파괴 오버레이*.
→ 스타일 세트 번역: 브랜드 룩 = 위의 트림 레이어, 베이스 보정 = 그 아래. 룩을 베이스에 굽지 말 것.

## Base + Variant 프리셋 시스템 (사진 업계)

- **Mastin Labs**: 필름스톡 특화, Fuji Frontier 스캐너 스캔 기반. film+digital 하이브리드 *일관성*. 양보다 질 — *소수의 잘 튠된 룩*.
- **RNI All Films**: 레퍼런스 테이블 + 실제 슬라이드/프린트 다소스.
- **공통 패턴**: 베이스 보정 1개 + *작은* 스톡/무드 변주 세트. 변주는 톤/콘트라스트로 갈리고 *컬러 DNA 는 공유*. (수십 개 X)

## 우리 스택 매핑 (Capture One costyle + .cube)

- **BASE_Core** = Balance + Creative-Look 컬러 DNA (WB, ColorBalance 3-way split-tone, Color Editor, Saturation). 브랜드 아이덴티티 레이어. Opacity 100.
- **Mood/Tone 변주** = Contrast + HDR(Highlight/Shadow/Black/White). 극단 제작, layer opacity 로 적용. 무드(dark/bright 등)로 갈리고 BASE 컬러는 공유. *변주축은 브랜드 데이터가 결정* (mukayu 는 indoor/outdoor 가 아니라 dark-mood/bright-product 였음).
- **Util/Trim** = Clarity, ClarityStructure, UsmAmount/Radius, Vignetting, FilmGrain*. 마지막 레이어, 낮은 opacity.
- **.cube LUT** (`tools/photo-lut.py`) = 레퍼런스 셋에서 룩을 *충실히 복제*(색전이). 손으로 짜는 대신 기존 앨범 룩을 클론하고 싶을 때. = Creative-Look 레이어 자리. 적용은 `tools/lut.mjs`.
- 슬라이더형 costyle 이 ICC/fcrv 사이드카(LUT2C1)보다 우선 — 포터블·편집가능.

## 하드원 룰 (하지 말 것)

- **하나의 LUT 에 다 굽지 마라** — 트림 가능성 상실.
- **정규화 전에 크리에이티브 룩 적용 금지** — 예측 불가.
- **이미 그레이딩된, 내용 다양한 출력에서 절대 색/톤 자동 역산 금지** — underdetermined. mukayu run 에서 확인: 피사체색(나무·다다미)이 시그니처를 오염. *상대 split-tone* 만 안정적으로 추출 가능, 나머지는 콜로리스트의 눈 또는 충실한 LUT 복제(.cube)로.
- **소수의 강한 변주 + opacity 트림 > 다수의 변주.**

## Sources

- [Gamut — What makes a LUT cinematic (technical vs creative)](https://gamut.io/what-makes-a-lut-cinematic-understanding-the-art-and-science-behind-the-look/)
- [BeverlyBoy — Technical or Creative? Decoding the LUT spectrum](https://beverlyboy.com/film-technology/technical-or-creative-decoding-the-lut-spectrum/)
- [Juan Melara — Basic Resolve node structure & order of operations](https://juanmelara.com.au/blog/basic-resolve-node-structure-and-order-of-operations)
- [Juan Melara — Print film emulation LUTs](https://juanmelara.com.au/blog/print-film-emulation-luts-for-download-old)
- [Mixing Light — What makes film print emulation LUTs special](https://mixinglight.com/color-grading-tutorials/what-makes-film-print-emulation-luts-special-and-how-do-you-use-them/)
- [OpenColorIO — Contexts / pipeline authoring](https://opencolorio.readthedocs.io/en/latest/guides/authoring/contexts.html)
- [Autodesk — Working with ASC CDLs](https://download.autodesk.com/us/toxik/toxik2009help/html/BABBEFIE.html)
- [Mastin Labs](https://mastinlabs.com/)
- [RNI All Films review (35mmc)](https://www.35mmc.com/25/07/2016/really-nice-images-review/)
