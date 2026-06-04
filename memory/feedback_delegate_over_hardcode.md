---
name: ""
metadata: 
  node_type: memory
  originSessionId: f1f8769d-644b-404b-9ead-b76202a64eae
---

사용자가 컴포넌트에 대해 "옵션이 너무 많다 / 밖에서만 받아라 / 기본값 없애라"고 하면, **고정 동작을 하드코딩하고 기능을 삭제하는 것이 아니라, 그 역할을 외부 슬롯으로 *위임*하라.** 하드코딩 = 역할을 없앤 것(유연성 상실). 위임 = 역할 분담(외형/레이아웃/행동을 각각 분리).

**Why:** 2026-06-02 CMSGalleryCarousel(Framer 캐러셀). "화살표·인디케이터 노브 줄이고 밖에서 받아"라는 말에 처음엔 위치를 *고정값으로 하드코딩*(=레이아웃 엔진 삭제)했다. 사용자가 즉시 교정: *"엔진 노릇을 그만두는 건 좋은데, 레이아웃 엔진 역할을 다른 것이 할 수 있도록 역할을 분담하게 해줘야지 — 컴포넌트를 입력 받아라 했던 것처럼."* 즉 노브 더미의 근본 원인(캐러셀이 레이아웃 엔진 노릇)을 *삭제*가 아니라 *외부 위임*으로 끊는 것이 정답. [[feedback_single_solution]] 의 "경로 자체를 없앤다"와 같은 자리.

**How to apply:**
- 역할을 3분할로 보라 — **외형**(모양) / **레이아웃**(배치·간격·정렬·위치) / **행동**(상태·콜백). 각각을 밖에서 받을 수 있는지 먼저 검토.
- Framer 메커니즘: `ControlType.ComponentInstance` 로 컨테이너(Stack)를 받고, `React.cloneElement(instance, { style/props }, ...children)` 로 아이템을 children 주입 → 그 Stack 이 레이아웃 엔진. (Framer 프레임은 자동으로 안 늘어나니 채울 땐 width/height 명시.) 외형은 별도 item 슬롯, 행동(active variant 주입·onClick)만 코드에 남긴다.
- 슬롯 미연결 시 **노브 없는 최소 폴백**을 둬서 안 깨지게. 폴백 상수는 패널 노브가 아니므로 "기본값 없애라"에 위배 안 됨.
- 결과 점검: 노브 N개 → 슬롯 몇 개 + 행동 바인딩으로 줄었는지. 줄지 않았으면 아직 위임 못 한 것.

**위임 메커니즘 지도 (Framer, 무엇을 무엇으로):**
- 외형(모양 1개) → `ControlType.ComponentInstance`
- 레이아웃(컨테이너) → `ControlType.ComponentInstance` + `cloneElement(…, children)` 주입
- 반복 아이템(N개 이미지 등) → `ControlType.Array`(`control:{type}` 단수) — 개수 제한까지 사라짐. ※ `ControlType.Image` deprecated → `ControlType.ResponsiveImage`
- 애니메이션 파라미터(곡선·시간) → `ControlType.Transition` 하나 (공유 Transition 변수 바인딩 가능 → simple 노브 easing/duration/bounce/source 통째 제거)
- 변형마다 달라져야 하는 시각값(딤 등) → 슬롯 말고 **단순 prop**(Color/Number). prop 이라야 Framer 배리언트가 전환 시 자동 보간. (2026-06-02 dim 사례)

**경계 — 위임하면 안 되는 것 (과잉 적용 방지):** 스칼라 *값노브*(autoplay·loop·startIndex·radius·objectFit·drag 임계값 등)는 컴포넌트/변수로 받을 게 아니라 그냥 값이다. 억지 위임은 또 다른 군더더기 = "막았다는 기분". 위임 대상 = 컴포넌트/레이아웃/반복아이템/애니메이션변수/배리언트-구동 시각값. 나머지 스칼라는 그대로 둔다. ("대부분 밖에서" ≠ "전부 밖에서".) 사용자가 "더 찾아봐"면 전수 감사 후 *되는 것/안 되는 것을 근거와 함께* 표로 보고.

관련: [[feedback_component_level_tone]] (외형/톤을 컴포넌트에 박는 같은 방향), [[feedback_reference_class]] (위임 패턴은 구현 전 동작 레퍼런스로 확인), [[feedback_framer_asset_convention]].
