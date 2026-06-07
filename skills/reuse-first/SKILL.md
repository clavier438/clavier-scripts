---
name: reuse-first
description: >-
  clavier-scripts 코드베이스에서 새 도구·스크립트·기능을 만들거나 기존 것을 고칠 때 *가장 먼저* 적용하는 작업
  방식. 처음부터 짜지 말고 이미 수없이 검증된 기존 바퀴(`tools/lib/` 공유 헬퍼, front door 패턴,
  `run_claude`·`airtable-api` 같은 모듈)를 먼저 찾아 재사용·조합하고, 같은 코드가 2곳 이상 복붙돼 있으면 공유
  모듈(`tools/lib/`)로 추출해 모듈식으로 구조화한다. "도구/스크립트 만들어", "기능 붙여", "이거 고쳐/추가해",
  "재사용", "모듈화", "바퀴 재발명하지 마", "중복 합쳐", "조합해서", "lib으로 빼", "구조화해" 같은 말이
  나오거나, 새 .py/.mjs/.sh 파일을 작성하려 할 때는 — 사용자가 '재사용'이라고 명시하지 않았더라도 — 반드시 이
  스킬을 적용할 것. 클린 아키텍처(SRP·DRY)를 clavier 에서 실제로 실행하는 절차 + 검증된 바퀴 카탈로그.
---

# reuse-first — 검증된 바퀴를 먼저 (clavier-scripts)

## 왜 이게 기본 작업 방식인가

clavier-scripts 는 *맥락이 겹치는 도구들의 모음*이다. claude CLI 호출, Airtable CRUD, 색 출력, repo 경로 탐색, CSV upsert — 같은 일을 여러 도구가 한다. **이미 검증된 바퀴를 다시 짜면 = 복붙 중복 = drift.** 한쪽만 고쳐지는 순간 동등성이 깨지고, 사용자가 모르는 사이 두 도구가 다르게 행동한다. 사용자는 그게 도는지 안 도는지조차 모르게 된다.

이 스킬은 추상적 원칙이 아니라 *실제 사고에서 태어났다*: `run_claude`(claude CLI 구독 빌링 호출)가 `tools/brandguide.py`·`tools/photo-pattern.py` 에 이미 **복붙 2벌**로 있었고, image-tagger 마이그레이션에서 무심코 *세 번째*를 만들 뻔했다. 그 자리가 바로 "공유 모듈로 추출" 신호였다.

목표: 새 코드 한 줄을 쓰기 전에 **"이 바퀴, 이미 있나?"** 를 먼저 묻는 습관을 구조화한다.

## 절차

### 1. 인벤토리 먼저 — 짜기 전에 찾는다
- [`references/wheel-catalog.md`](references/wheel-catalog.md) 를 읽어 이미 추출된 공유 바퀴를 확인한다.
- 현재 바퀴 목록을 *직접 떠본다* (카탈로그는 변할 수 있으니 — 생성형 우선):
  ```bash
  for f in tools/lib/*.mjs tools/lib/*.py tools/lib/*.sh tools/lib/copy/*.mjs; do
    echo "• ${f#tools/lib/}"; head -6 "$f" | grep -E '^(//|#)' | head -2; done
  ```
- 비슷한 맥락의 기존 도구를 grep 한다: `grep -rn '<기능 키워드>\|def <비슷한함수>' tools/`
- 외부 호출(claude·airtable·doppler·cloudflare), 색/메뉴 UX, repo 경로, CSV/upsert 는 **거의 다 이미 있다.** 못 찾으면 다시 의심하라 — 보통 내가 덜 찾은 것이다.

### 2. 재사용·조합 — 새로 짜지 말고 import
바퀴가 있으면 그것을 가져다 쓴다. 언어별 진입:
- **.mjs**: `import { runClaude } from "./lib/copy/runner.mjs"` 식.
- **.py**: `sys.path.insert(0, os.path.join(TOOLS, "lib")); import freshness` (brandRe.py 패턴).
- **.sh**: `source "$(dirname ...)/lib/repoPaths.sh"`.
- 다언어가 필요하면 같은 바퀴를 언어별로 둔다 — `freshness`(.mjs/.py/.sh), `repoPaths`(.mjs/.sh) 가 표준. 인터페이스를 동일하게 맞춘다.

### 3. 중복 발견 → 추출 (복붙 2곳+ = lib 으로)
같은 코드가 2곳 이상에 있거나, 내가 *세 번째 복붙*을 만들려 하면 → 멈추고 추출한다:
1. `tools/lib/<name>.<ext>` 로 공통 로직을 뽑는다.
2. **기존 복붙 자리를 *모두* 그 공유 모듈을 import 하도록 교체한다.** 한 곳만 바꾸면 동등성이 더 깨진다 — 추출의 핵심은 *단일화*다. 하나만 새 모듈을 쓰고 나머지가 옛 복붙이면, 갈래가 셋으로 늘어난 셈이다.
3. 동작이 바뀌지 않았는지 각 소비자에서 확인한다 (회귀 0).

### 4. 모듈식 구조화 — front door + 내부 모듈
사용자가 *동사 하나*로 쓰게 만든다: 얇은 verb 라우터(front door) + 그대로 둔 내부 모듈. clavier 표준 = `brandRe`(capture/organize/tag/report/status/open) · `copy` · `workerCtl` · `framer`. 내부 모듈은 단독 실행도 되게(자족) 두고, front door 는 그것들을 순서대로 부르기만 한다. 모듈성은 안 깨진다 — 라우터는 얇다.

## 트레이드오프 — 재사용·추출이 늘 옳은 건 아니다

합치기 전에 *기능 비용*을 확인하라 (`feedback_delegate_over_hardcode` 메모리와 같은 자리):
- **결합도**: 두 소비자의 요구가 갈라질 조짐이면, 공유 모듈이 오히려 둘 다 옥죈다. *지금 같고 앞으로도 같을 것*만 추출한다.
- **기능 손실**: 단순화·위임이 바인딩·변형·제약우회 같은 *의도된 기능*을 죽이지 않는지. (사례: Framer image1~10 개별 슬롯을 `Array` 로 뭉쳤다가 CMS 바인딩을 잃음 — 단순화에 기능 비용이 붙은 경우.)
- **억지 추상화**: 스칼라 값노브(autoplay·radius·임계값)까지 모듈로 빼는 건 또 다른 군더더기다. "대부분 재사용" ≠ "전부 추상화".

판단이 안 서면 *되는 것/안 되는 것을 근거와 함께* 한 번 보고하고 진행한다 (멈춰 묻기보다 — ownership).

## 안티패턴 = drift 신호
- **inline 재구현** — 공유 헬퍼를 두고 또 짜기. 특히 `repoPaths` 안 쓰고 절대경로 하드코딩하면 환경(Mac 콜로니 ↔ OCI ↔ web)을 옮기는 순간 죽는다.
- **복붙 N벌** — 한쪽만 고쳐지면 동등성 붕괴. `run_claude` 가 이미 그 직전이었다.
- **front door 없이** 내부 모듈을 사용자에게 직접 노출 — 사용자가 모듈 구조를 외워야 하는 짐.

> 이 스킬은 `CONVENTIONS.md` "⚠️ Clean Architecture 원칙"(SRP·DRY)과 `ARCHITECTURE.md` "sibling-first 공유 헬퍼"를 *clavier 에서 실제로 실행하는 절차*다. 원칙 선언은 거기, 실행 절차와 카탈로그는 여기.
