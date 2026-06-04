---
name: framesync-market-reality
description: framer-sync(Airtable→Framer 싱크) 상품화 시장 현실 — 무료 1st-party 플러그인이 기본 해자를 붕괴시킴. 차별점은 서버사이드 자동화뿐.
metadata: 
  node_type: memory
  type: project
  originSessionId: 363c33c5-8f88-4775-beeb-d107ca8112f2
---

framer-sync 를 "Airtable→Framer 싱크" 상품으로 파는 *기본 해자는 이미 깨졌다*. (조사 2026-06-01, web search 근거)
- **Framer가 2026-03 자체 Airtable CMS 플러그인을 무료·오픈소스·1st-party로 출시** — References/Multi-References 포함 필드 매핑, 원클릭 재싱크. "Airtable→Framer 싱크"라는 간판 가치는 이제 공짜.
- 살아남은 유료 경쟁자(FramerSync by Isaac Roberts)는 **일회성 결제** (구독 아님) → 이 니치는 구독 저항.
- 이름 충돌: 사용자 제품 `framesync` vs 기존 `FramerSync` (발견성·브랜드 불리).
- **여전히 남은 유일한 차별점 = 무인 서버사이드 자동화** (Cloudflare cron/Airtable webhook으로 Framer 안 열고 자동 갱신). 공식·경쟁 플러그인은 둘 다 에디터에서 클릭해야 함.

**Why:** ADR-001(saas/DECISIONS.md)이 해자로 잡은 "공식 플러그인은 못 한다"가 출시로 무효화됨. 이걸 모르면 가치 없는 self-serve SaaS를 짓게 됨.

**How to apply:** self-serve 구독 SaaS(PR #69의 `saas/` D1 store·customerResolver·자동 온보딩 기계)는 *지금 목표엔 짓지 말 것*. 대신 차별점(자동화)을 살려, 이미 돌아가는 per-tenant 워커(`workerEnvMap` + Doppler config + `[env.X]`, mukayu 방식)로 **본인 스테이 클라이언트에 붙는 관리형 리테이너**를 운영 — [[monetization-as-byproduct]] 와 직결. 관련: [[project_platform_workers]], [[project_hotel_agency_ops]].

**★ 제품 thesis 재정의 (2026-06-01, 사용자 발화 — 가장 중요):** 가치는 "Framer 싱크"가 아니라 **Airtable 하나 → 여러 채널(웹·인스타·네이버·인쇄물·메일 등) 자동 fan-out** 으로 *운영 노동을 붕괴*시키는 것. native Framer CMS 가 "싱크"는 무료로 먹었지만 "운영 전체가 여기서 나간다"는 못 먹음 → 그게 진짜 락인이자 프리미엄 가격 근거(가격은 없애주는 노동량에 비례, 높여도 불만 없음). 클라이언트가 Airtable 을 직접 만지냐는 부차적 — 사이트는 native CMS 로 셀프관리해도 무방, 핵심은 cross-channel 자동화. **첫 wedge = 사용자가 sisoso/mukayu 운영하며 지금 손으로 반복하는 다채널 작업(dogfood → 그대로 제품).** "싱크 리테이너"보다 큰 빌드지만 점진·dogfood·기존 fan-out 인프라 보유로 de-risk.
