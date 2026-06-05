---
name: project_design_recon
description: "모든 웹/이미지/폰트/아이콘/컬러 추출 = 브랜드 아이덴티티 리버스 엔지니어링. 이 렌즈로 접근."
metadata:
  node_type: memory
  type: project
  originSessionId: 60e77a80-f14d-4e0f-8fdb-f083ca964d77
---

**목표 (사용자 명시, 2026-06-05):** webExporter 캡처·이미지 추출·폰트/아이콘/컬러 추출은 *파편적 수집기가 아니라* **한 목표의 레이어** — *브랜드가 아이덴티티를 어떻게 체계적으로 구성했는가를 리버스 엔지니어링*. 이미지 쪽은 **포토디렉션의 아키텍처**(어떤 사진 유형을·어떤 보정/톤/구도/비율로·어디에 배치).

**How to apply:**
- 사이트/브랜드 분석 작업이 들어오면 이 렌즈로 본다 — "이 추출이 아이덴티티 시스템의 어느 층을 드러내는가". 도구를 새로 만들 때도 design-recon 미션에 어떻게 붙는지 먼저.
- **이미지 샘플링 = exhaustive 다운로드 금지, 패턴 커버리지.** 패턴을 잡아가며 / 느껴질 만큼만 샘플 / 이미 축적된 패턴은 그만 / 새 패턴 탐색 / 패턴별 기록 + 배치 분석 (saturate-then-diversify).
- 분류=비전 비용 주의 → 규모 크면 API 소액충전이 에이전트보다 쌈([[project_anthropic_key_no_credits]]).

**축적 문서 (detail·진행상황):** `clavier-scripts/DESIGN_RECON.md` — 미션·레이어·방법·툴킷·다음 단계가 여기 쌓인다. 관련 도구: webExporter · image-tagger(6축) · photo-pattern(사진 문법) · image-dedup · site-icons. 언젠가 "design-recon" skill 로.
