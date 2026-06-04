# 2026-06-04 — site-icons: design-recon 도구 분리 (asset-collection 과 별개 책임)

> 이 ADR 은 **repo-scoped (leaf)** — Layer 1 system ADR 아님.
> clavier-hq/DECISIONS.md 정식 박제 + doc-coverage 12-doc cascade **불요** (근거 = 아래 "전파 범위").
> `docs/decisions/` 안에서 완결.

---

## 맥락

study/books 레퍼런스 워크플로우에 사이트 분석이 두 종류로 갈렸다:

1. **asset collection** — 사진 ref 수집 (`tools/image-ref-fetch.py` → `imageRefs/<brand>/` → `image-tagger.py` 태깅).
2. **design recon** — 그 사이트가 *무슨 아이콘 시스템*을 쓰는지 식별 (공개 라이브러리 vs 자체 SVG, 전달 방식).

사용자 요청: "아이콘세트 뭐 쓰는지 알 수 있나? 기능에 추가 가능?" → 14개 브랜드 실측 스캔으로 가능성 검증 후 도구화 결정.

## 결정

design recon 을 **별도 도구 `tools/site-icons.py`** 로 둔다. `image-ref-fetch.py` 에 합치지 않는다.

- 입력: URL (positional) 또는 `--csv name,url[,note]`. 출력: 사람용 표 / `--json`(파이프라인용).
- 판별: Wappalyzer 류 **시그니처 매칭** (라이브러리별 고유 class / font-family / CDN / web-component) + **전달방식 fingerprint** (inline `<svg>` / sprite `<use href=#>` / icon-font `<i>` 카운트).
- 정적 스캔 (raw HTML + 링크된 CSS 최대 2개) 만. 봇월/JS-주입 사이트는 `none in static HTML` 로 **정직 표기** (없는 게 아니라 못 본 것).
- precision 우선: class 접두사(`fa-`, `bi-` …)는 반드시 `class=""` 문맥 안에서만 매칭해 오탐 차단.

## 이유 (Clean Architecture — SRP)

- **변경 이유가 다르다 (SRP)**: 사진 수집(스크레이퍼 엔진·webp 변환)과 아이콘 식별(시그니처 레지스트리)은 서로 다른 축으로 바뀐다. 한 파일에 두면 한쪽 변경이 다른 쪽을 리스크에 노출.
- **의존성 방향 (decoupled)**: `site-icons` 는 stdlib + `freshness` 만 의존하는 leaf. image-ref 파이프라인에 역의존 0 — 양쪽이 서로를 모른다.
- **OCP**: 라이브러리 추가 = `LIBS` 리스트에 한 줄. 판별 로직 불변.
- **bounded context 의 첫 멤버**: "design recon" 은 아이콘에서 끝나지 않는다 (폰트·색·그리드). 별도 도구 family 로 둬야 다음 recon 이 *같은 모양*으로 붙는다.

## 거부된 대안

| 대안 | 거부 이유 |
|---|---|
| `image-ref-fetch.py --detect-icons` 플래그로 합침 | SRP 위반. 사진 수집기에 tech-profiling 책임 혼입 — 두 책임이 한 변경단위에 묶임. |
| rendered-browser(playwright/CIC) 부터 구현 | automation_order 위반. 정적 스캔이 ~10/14 커버 = 패턴 먼저 검증. 무거운 의존(메모리)·복잡도 선투입은 과설계 → v2 로 분리. |
| SVG path 대조로 인라인된 라이브러리까지 식별 | 가치 대비 복잡도 과다. v1 은 "라이브러리 여부 + 전달방식"에서 멈춤 → v2 후보. |

## 경계 — v2 (별도 작업, 지금 안 함)

- **`--browser` 모드**: 봇월(aesop·muji)·JS-렌더(sigma·gajoen) 4개 사각지대 → 세션 브라우저의 rendered DOM 검사 (`document.fonts` 로 번들된 icon-font 까지, SVG class 스캔). 이미지 캡처 패스와 한 번에 통합 가능.
- **SVG path 대조**: 높은 inline `<svg>` + 라이브러리 0 이 *손그림*인지 *빌드-인라인 라이브러리*(Lucide/Heroicons)인지 구분.

## 전파 범위 (왜 system ADR 아닌가) ★

이 결정은 `MAP.md` / `SYSTEM_ENV.md` / 루틴 / Doppler / 워커 어디에도 안 닿는다. 새 상주 프로세스 0, 새 secret 0, 새 루틴 0 (STL 무관 — on-demand 수동 도구). 따라서 clavier-hq `DECISIONS.md` 정식 박제와 doc-coverage 12-doc cascade 는 **불요**. leaf tool 의 결정을 system ADR 처럼 cascade 시키는 것 자체가 과process (`feedback_single_solution` 위반). repo-local ADR + docstring 으로 완결한다.

## 검증 (dogfood)

| site | 결과 |
|---|---|
| mtmlabo | Font Awesome (high), `<i>`×12 |
| leica | custom SVG sprite system (svg 621 / sprite 611) |
| aman | custom inline SVG (19) |
| sigma | none in static HTML (JS-rendered) — 정직 표기 |
| aesop | ⛔ 403 (봇월) — 에러 노출(은폐 없음) |

compile OK · freshness import 포함 · 표준 라이브러리만 (Pillow 불요).

## 구현

| 파일 | 내용 |
|---|---|
| `tools/site-icons.py` | 도구 본체 (시그니처 근거 URL = docstring 헤더에 인용) |
| `docs/decisions/2026-06-04-site-icons-design-recon.md` | 본 ADR |
