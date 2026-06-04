---
name: feedback-component-level-tone
description: Framer 이미지 컴포넌트에 브랜드 톤/그레이딩을 컴포넌트 레벨로 박는 방식 선호 (CSS filter + blend 오버레이 + 프리셋)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d692d3ba-b2b4-4c6e-869a-1537a213aecf
---

Framer 이미지 컴포넌트(캐러셀·갤러리 등)에서 **톤/색감 그레이딩은 개별 이미지가 아니라 컴포넌트 레벨**에 넣어 모든 슬라이드에 동일 적용하는 방식을 선호한다. 구현은 CSS `filter`(노출/대비/채도/흑백) + blend-mode 오버레이(색온도 근사/매트/비네팅/그레인) + 브랜드 프리셋 몇 개 + Custom 수동 슬라이더.

**Why:** 호텔/스테이 브랜드 사이트는 갤러리 전체 톤 일관성이 핵심인데, Photomator/Vignette 같은 사진앱 보정을 매 이미지에 하면 비파괴·일관성이 깨진다. 컴포넌트에 박으면 한 번에 사이트 전체 톤을 깔 수 있고, 비전문가(사용자)가 프리셋만 골라도 됨. CSS/SVG filter는 픽셀을 안 읽어 CMS 이미지 **CORS/canvas-taint 문제를 통째로 회피** — Canvas/WebGL로 가면 안 됨.

**How to apply:** 사진 보정 기능을 Framer에 넣자는 요청이 오면 "전역 톤 그레이딩"으로 해석해 컴포넌트 레벨 CSS filter + 오버레이로 설계. 진짜 화이트밸런스(색온도/틴트 분리)·하이라이트·섀도우·커브·샤픈이 필요하면 SVG `feColorMatrix`/`feComponentTransfer` 레이어를 추가(여전히 비파괴·CORS 안전). ML 보정/리터치/부분 마스킹은 전역 컴포넌트로 불가하니 선을 명확히 그을 것. 레퍼런스 클래스 = CSSgram(Una Kravets). [[feedback_reference_class]] [[project_framesync_market]]
