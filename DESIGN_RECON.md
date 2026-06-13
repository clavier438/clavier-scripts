# Design Recon — 브랜드 아이덴티티 리버스 엔지니어링

> 이 문서는 *축적된다*. 도구를 파편적으로 만들지 말고, 전부 아래 한 목표의 레이어로 둔다.
> (관련 leaf ADR: `docs/decisions/2026-06-04-site-icons-design-recon.md`)

## 한 줄 목표

**브랜드가 자기 아이덴티티를 *어떻게 체계적으로 구성했는가*를 리버스 엔지니어링한다.**
웹사이트 구조 · 이미지 · 폰트 · 아이콘 · 컬러 추출은 *전부 이 한 목표의 레이어*다. 따로 노는 수집기가 아니라, 한 브랜드의 *설계도*를 역으로 복원하는 작업.

이미지 쪽은 곧 **포토디렉션의 아키텍처** 분석 — 어떤 사진을, 어떻게 연출·보정해서, *어디에 배치*했는가의 체계.

## 레이어 (각 추출 = 아이덴티티 시스템의 한 층)

| 레이어 | 질문 | 도구 |
|---|---|---|
| **IA / 레이아웃** | 어떤 페이지 유형·구조로 짰나 | `webExporter` 캡처, `site-layout-capture` 스킬 |
| **포토디렉션** | 어떤 사진 유형을·어떤 톤/보정/구도/비율로·어디에 | `image-tagger` (6축) → `photo-pattern` → `photo-lut` (그레이딩 .cube LUT) |
| **타이포그래피** | 어떤 서체 시스템 | `webExporter --download-fonts` |
| **아이코노그래피** | 어떤 아이콘 시스템 (라이브러리 vs 자체 SVG, 전달방식) | `site-icons.py` |
| **컬러** | 브랜드 팔레트 | `webExporter --extract-colors` |

→ 목표 산출물 = 브랜드별 **"아이덴티티 구성 리포트"** = `recon/brandguide_v<NN>.html` (각 레이어를 어떻게 설계했나, styled HTML 단일 산출. DECISIONS 2026-06-05).

## 사용법 — 단일 진입점 `brandRe` (workerCtl/framer 패턴)

사용자는 **명령 하나 `brandRe`** 에서 동사만 고른다. 내부 모듈(webExporter·recon·image-tagger·brandguide)은 그대로 — `brandRe` 는 얇은 라우터(front door). DECISIONS 2026-06-06 brandRe ADR.

```bash
brandRe <url>              # 풀 파이프라인: 캡처 → 정리 → HTML 보고서 (한 줄)
brandRe <폴더>             # 이미 가진 사진 폴더 분석 (캡처 생략 → organize→tag→report, --as <이름>)
brandRe capture <url>      # 로컬 webExporter 캡처 → books/<host>/ (PDF + images/)
brandRe organize <host>    # 정리 (photos·icons·_layers.json + 보고서 자동)
brandRe tag <host>         # 사진 6축 비전 분류 (image-tagger) — _tags.json 채움
brandRe report <host>      # brandguide HTML 보고서만 (재)생성
brandRe status [<host>]    # 레이어 멀티태그 상태 — 없으면 books/ 전체 목록
brandRe open <host>        # 보고서 브라우저로 열기
```

`brandRe status <host>` 가 핵심 — workerCtl `status` 처럼 *어느 레이어까지 됐고 다음에 뭘 하면 되는지* 를 멀티태그로 보여준다 (✓ ready / ◐ pending / · missing + `다음:` 힌트). books 루트 = `$BRANDRE_BOOKS` > `./books`.

> **내부 모듈** (직접 호출도 가능, 평소엔 `brandRe` 로): `recon.py`(=organize 엔진) · `brandguide.py`(=report 렌더) · `image-tagger.py`(=tag) · webExporter(=capture). `brandRe` 가 이들을 순서대로 부른다.

- 보고서 = **HTML brandguide 하나** (구 `_report_v<NN>.md` 폐기). 서술 리드 *및 비전 분류(image-tagger)* 모두 `claude` CLI 구독 빌링 — 서술은 없으면 findings-only. (AI 호출 통일: docs/decisions/2026-06-07-vision-claude-cli-billing.md)
- **레이어 멀티태그 매니페스트** (`recon/_layers.json`): 각 레이어 `{status, count, tags:[...]}`. brandguide 는 폴더를 stat 하지 않고 *태그를 읽어* 섹션 포함을 결정 → 채워진 레이어만 렌더, 없으면 graceful skip. (예: `_tags.json` 없으면 photos 섹션만 빠짐.)
- **캡처 두 경로**: `brandRe capture`(로컬 webExporter, PDF+images, 빠름) vs `webexp`(OCI 원격 크롤, 무거운 사이트). 로컬 캡처는 colors/fonts 미생성 — 해당 레이어는 status 에서 `·`(missing) 로 정직히 표시.

## 포토디렉션 아키텍처 — 분석 방법

`image-tagger` 6축 분류 → `photo-pattern` 이 다음을 계산:
1. **아키타입** — 반복 시그니처(피사체·톤·비율 조합) = 브랜드가 쓰는 사진 *유형*들.
2. **의도적 룰** — 피사체별로 *다른 축이 얼마나 고정*됐나 (예: theslow 실내→내추럴88%, 인물→중앙83%). 높을수록 의도된 규칙.
3. **조합 문법** — 톤×후보정 페어링, 피사체 동시출현.
4. **배치(어디 쓰이나)** — ★ 미구현. 각 패턴이 *어느 페이지 유형/섹션*에 쓰이는지 (캡처 시 페이지 맥락 기록 필요).

## ★ 패턴 발견 샘플링 원칙 (saturate-then-diversify)

> 사용자 정의 (2026-06-05). **"모든 사진을 받는 건 비효율적이다."**

exhaustive download 가 아니라 **패턴 커버리지**가 목표:

1. 추출하며 **실시간으로 패턴을 잡아간다** (분류 → 클러스터).
2. 한 패턴은 *느껴질 만큼만* 샘플한다 (대표 N장).
3. **이미 충분히 축적된 패턴은 더 받지 않는다** — saturation 도달 시 그 패턴 중단.
4. 대신 **아직 못 본/희소한 패턴을 우선 탐색**한다 (novelty-seeking).
5. **패턴별로 기록** + 각 패턴이 *어디 쓰이는지(배치)* 분석.

구현 스케치 (다음 도구 = "패턴 발견 샘플러"):
- `image-dedup` 의 perceptual 클러스터 + `photo-pattern` 의 아키타입을 **추출 루프 안으로** 끌어들인다.
- 후보 이미지 스트림 → dhash/축분류로 클러스터 배정 → 클러스터 카운트가 N(예 3~5) 도달하면 그 클러스터는 skip, 새 클러스터에 속하는 것만 저장 → 클러스터당 대표 + 출현 위치(URL/섹션) 기록.
- 결과: 브랜드당 *exhaustive 200장* 대신 *패턴 커버하는 ~40장* + 패턴↔배치 맵.

## 툴킷 (현재)

`webExporter/webSiteExporter.py` (캡처·이미지/폰트/컬러 추출 + 이미지별 웹fx/렌더크기 `_webfx.json`) · `recon.py` (per-host 레이어 정리 + `_layers.json` 매니페스트 + brandguide 자동 호출 = 파이프라인 오케스트레이터) · `image-ref-fetch.py` (정적 수집) · `image-tagger.py` (6축 분류 → Finder + XMP 키워드) · `photo-pattern.py` (사진 문법 findings 계산) · `brandguide.py` (findings + 레이어 태그 → HTML 보고서 렌더) · `image-dedup.py` (중복 제거, perceptual) · `photo-lut.py` (사진 → 컬러그레이딩 `.cube` 3D LUT, 톤 구간별 split-toning 포착 + 정책별 자동 분리, organize 가 `recon/luts/` 자동 생성) · `site-icons.py` (아이콘 시스템 식별).

비용: 분류=비전. **image-tagger 가 claude CLI 구독 빌링(`tools/lib/claude_cli.py`, copy.mjs 방식)으로 전환(2026-06-07) — 별도 API 크레딧 0.** `--json-schema` 로 6축 구조화 출력, `ANTHROPIC_API_KEY` 불필요. claude CLI 미인증 환경(OCI cron 등)에선 `--from-json` 우회(세션/subagent 분류 → 주입) 유지. `memory/project_anthropic_key_no_credits` 참조.

### 사진 정리 외부 CLI 도구 — 검토 결과 (2026-06-13)

Capture One 앞단/옆단 "정리·중복·해상도" 보완용으로 검토(외부 추천 + 라이선스 확인). **결론: "화질 다른 동일 사진 → 최고화질만 남기기" 는 신규 설치 없이 이미 `image-dedup.py` 가 정확히 해결한다** (perceptual dhash 클러스터 → 클러스터당 태그>고해상(픽셀수) 1장 보존, HEIC 포함, 오프라인·토큰 0). 동일 사진의 화질 선택은 *픽셀수* 가 결정론적 정답이라 별도 도구가 불필요.

| 도구 | 상태 | 판단 |
|---|---|---|
| **exiftool** (free, Perl) | ✅ 설치됨 `/opt/homebrew/bin/exiftool` | 메타데이터/해상도 읽기·rename·이동 표준칼. 규칙 기반 재정렬 시 조합. |
| **ImageMagick** (free, Apache-2.0) | ✅ 설치됨 (`magick`·`identify`·`convert`) | 해상도/포맷 추출, 변환. `image-convert.py` 가 이미 래핑. |
| **Czkawka** (free, MIT) `czkawka_cli` | ⬜ 미설치 — 보류 | 사진 중복은 `image-dedup.py` 가 동일 기능 커버. *영상·빈폴더·broken file* 정리까지 필요해지면 그때 도입 후보 (image-dedup 범위 밖). |
| **BRISQUE/NIQE** (지각 화질점수) | ❌ 미채택 | "동일 사진 다른 화질" 엔 **틀린 경로** — 다운스케일본이 노이즈가 가려져 점수가 더 높게 나올 수 있음. 픽셀수가 정답. 지각점수는 *서로 다른 컷* 중 선별할 때만 의미 → 그건 image-tagger 6축이 담당. |
| **digiKam** (free, GPL) | ❌ 미채택 | GUI DAM(얼굴인식·라이브러리). "터미널에서 순식간에" 목표와 어긋나는 오버킬. |

> 즉 추가 설치 없이 **exiftool + ImageMagick + `image-dedup.py`** 로 캡처원 앞단 정리 레이어 완비. 모듈 확장은 image-dedup 가 못 미치는 *범위*(영상/빈폴더/깨진파일)가 실제로 나타날 때 czkawka 를 front door 뒤에 얹는 식으로 — 바퀴 재발명 없이.

## 다음 (미정립 — 이 문서가 정립 과정)

- [ ] **배치 분석** — 캡처 시 각 이미지의 페이지유형/섹션 기록 → 패턴↔배치 맵.
- [ ] **패턴 발견 샘플러** — 위 saturate-then-diversify 를 추출 루프에 구현.
- [x] **레이어 통합 리포트** — `brandguide.py` → `recon/brandguide_v<NN>.html` (포토+타입+아이콘+컬러 한 장, 태그 기반 섹션). 2026-06-05 구현. 남은 것: IA/레이아웃 섹션 (배치 분석 의존).
- [ ] **skill 화** — "design-recon": 브랜드명/URL → 전 레이어 리버스 엔지니어링 → 리포트. 접근이 충분히 정립되면.
