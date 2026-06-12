---
name: framer-to-email
description: >-
  Framer 로 디자인한 페이지(웹 URL)를 이메일-세이프 HTML(인라인 CSS·테이블 레이아웃)로
  *결정론적으로* 변환하는 작업의 방법론·도구 위치·레퍼런스·트릭 모음. 핵심 통찰 = "Framer→이메일"
  전용 도구는 세상에 없고(임의 레이아웃→테이블의 모델 갭), 뉴스레터=세로 블록 제약으로 그 갭을 우회하면
  렌더된 DOM 을 세로 위치순으로 읽어 computed style 그대로 인라인 emit 하는 결정론 변환이 가능하다(AI 0).
  도구 = `clavier-scripts/tools/framerEmail.py` (`framerEmail <url>`). 이메일은 제약이 극심해 트릭이
  ~15개로 유한하며 `tools/framerEmail.refs/`(Cerberus 정전 + 스티비 실물 + TRICKS.md)에 압축돼 있다.
  "프레이머 이메일 만들어", "framer 디자인 이메일 html 로", "뉴스레터 html 변환", "이메일 템플릿
  프레이머에서", "framer→email", "framerEmail", "스티비에 붙일 html", "이메일 폭/배경/반응형 대응",
  "SVG 이메일에서", "이메일 트릭" 같은 말이 나오면 이 스킬을 적용할 것.
---

# framer-to-email — Framer 디자인 → 이메일-세이프 HTML (결정론)

## 한 줄

Framer 게시 URL → `framerEmail <url>` → 이메일-세이프 HTML. **AI 0, 매번 동일, 공짜.**
디자인은 Framer 에서만 하고, 변환은 이 도구가 반복 가능하게(사용자 자립).

## 레퍼런스 클래스 (왜 이렇게 하나 — 2026-06 확인)

- **"Framer→이메일" 전용 도구는 없다** (Webflow 위시리스트 수년째). 임의 웹 레이아웃(flex/absolute)을
  이메일 테이블 모델로 옮기는 건 *lossy + 1:N*(정답 여러 개) 라서. 모델 갭이 본질.
- 결정론 도구는 **CSS 인라인화**(juice/premailer)만 해결됨. **레이아웃→테이블**은 *제약된 입력에서만*
  결정론(Inky 의 `<row>/<columns>` 약속 문법).
- → **우회: 뉴스레터=세로 블록**. 이 제약이면 렌더된 DOM 을 *세로 top 순* 으로 정렬하면 div 중첩과
  무관하게 스택 구조가 잡힌다. 간격·정렬·인셋은 하드코딩하지 말고 *렌더된 실제 기하* 에서 읽는다.

## 도구

- 위치: `~/dev/clavier/clavier-scripts/tools/framerEmail.py` (branch `feat/framer-to-email` — main 머지 전이면 worktree 확인)
- 실행: `framerEmail <Framer-URL> [--out f.html] [--width 600] [--viewport N] [--no-icons] [--no-open]`
- 의존(reuse-first): **webExporter venv 의 playwright/chromium 재사용**(새 venv 안 만듦) + SVG 호스팅에
  **framer-sync R2 버킷 + 워커 `/webp-cache/<key>` 서빙 재사용**(`doppler` 가 CF 토큰 주입).
- 파이프라인: ① playwright 렌더 → ② DOM 을 세로순 블록(text/image/button/divider/icon)으로 추출 +
  computed style + 기하 → ③ 테이블 기반 인라인 HTML emit → ④ SVG 는 래스터화→R2 업로드→`<img>`.

## 레퍼런스 위치 (학습용, 이미 수집됨)

`clavier-scripts/tools/framerEmail.refs/`:
- `TRICKS.md` — **이메일 트릭 ~15개 압축 + 도구 적용 현황**. 작업 전 먼저 읽을 것.
- `cerberus/` — Cerberus(Ted Goas) 정전 패턴 3종(fluid/responsive/hybrid)+README. 주석=트릭 설명.
- `stibee-spread-by-b.html` + `public_email.css` — 실물 ESP(스티비) 래퍼 구조.

## 핵심 구현 지식 (재발견 비용 큰 것들)

- **이미지 aspect**: Framer 는 자연비(3:2)를 렌더박스 비율(16:9)로 `object-fit:cover` crop. height:auto 면
  자연비 풀로 늘어남 → 렌더박스 W×H 로 `aspect-ratio`+`object-fit:cover`.
- **버튼 박스 테두리**: Framer 는 `<a>` *자손 div 의 `::after` pseudo-element* 에 테두리를 둔다. 조상만
  보면 못 찾음 → btnEl+자손 × `[null,'::after','::before']` 스캔. 4면 테두리(또는 배경)만 버튼(위/아래만=구분선).
- **SVG**: 이메일은 인라인 SVG·data URI(Gmail) 못 띄움 → **래스터화(webp)→호스팅→`<img>`** 가 유일한 답.
  playwright `locator.screenshot()` + PIL webp + content-hash dedup → R2 업로드(`doppler run -- wrangler r2
  object put framer-sync-webp-cache/<key> --content-type image/webp --remote`) → 워커 URL. 인증/오프라인이면
  graceful skip. 같은 행 좌측 아이콘+텍스트는 인라인 결합("+ 항목").
- **구분선**: 1px 가로선 DIV(배경색 있음, height<2)는 스킵되기 쉬움 → divider 블록으로 별도 캡처.
- **간격/정렬**: 하드코딩 금지. 세로 간격=(다음 top−이전 bottom), 좌우 인셋=(left−frameLeft)/frameWidth %(반응형).
- **폰트**: 네이티브 px 유지(scale=1). 억지로 넓혀 글자 키우면 단아함 깨짐. Framer "X Placeholder" 폰트 제거.
- **넓은 폭 대응(TRICKS.md ★)**: 배경색 3곳(body+center+mso) · max-width 중앙+Outlook ghost table ·
  full-bleed 배경 밴드(풀폭 bg + 안쪽 max-width 중앙). ← 도구에 아직 미적용(다음 작업).

## 워크플로 (이 작업 특유)

1. **레퍼런스/실물 먼저** — 추측 말고 동작하는 케이스(스티비 공유 URL, Cerberus) 받아 학습.
2. **스크린샷 피드백 루프** — 원본 Framer 페이지 vs 출력 HTML 둘 다 같은 폭으로 풀페이지 스샷 → PIL 로
   나란히/하단크롭 합쳐 *직접 비교* → 차이 잡고 고침. "숨은그림찾기" 사용자한테 시키지 말 것.
3. **버전마다 커밋** — 각 수정(aspect/구분선/버튼/SVG…)을 개별 커밋.
4. **graceful fallback** — 호스팅/인증 없어도 이메일은 생성(아이콘만 skip).

## 더 큰 맥락 (이 도구가 들어가는 깔때기)

- 목적: 단일 작성지점(Framer/journal) → 다중 엔드포인트(웹=Framer, 이메일=스티비) COPE.
- 콜드 세일즈: 타겟 브랜드 컨셉 이메일을 *내 메일로* 발송 → 밑단에 정체 공개+세일즈+"구독하기(내 스티비
  구독폼)" → 구독(동의)하면 정식 뉴스레터(스티비) 합법 발송.
- 관련: `platform-workers` 브랜치 `feat/stibee-newsletter` = journal→스티비 캠페인 발송 워커 모듈
  (스티비 캠페인 API: `POST /emails` → `POST /emails/{id}/content`(text/html) → `POST /emails/{id}/send`,
  프로/엔터프라이즈 전용, AccessToken 헤더). 스티비는 인라인 스타일만 지원.
