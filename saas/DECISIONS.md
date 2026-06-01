# FrameSync — 의사결정 기록 (ADR)

> 왜 이렇게 정했는지 누적. 새로 이어받는 사람이 "왜 이렇게 했지?" 를 여기서 찾는다.
> 형식: 날짜 · 결정 · 맥락 · 근거 · 결과.

---

## ADR-001 (2026-06-01) — 코드 판매가 아니라 구독 SaaS

**결정**: framer-sync 를 일회성 코드 판매가 아니라 **멀티테넌트 구독**으로 상품화.

**맥락**: framer-sync 는 내가 가장 공들인 도구. 공식 Framer Airtable 플러그인이 있지만,
일괄 upsert / Worker 자동화 / UTM 일괄관리를 못 해서 워크플로우가 근본적으로 다름.

**근거** (코드 판매 vs SaaS 비교):
- 코드 판매: IP 보호 없음(포크해서 누가 위에 쌓아도 막을 길 없음), 구매자 풀 좁음(직접 배포 가능한 개발자만), 판매 없는 달 = $0.
- SaaS: 코드 안 줘도 됨(포크 불가), 풀 넓음(비개발자도), 반복 수입.
- 공수 차이가 "멀티테넌트 한 번 잡기" 하나뿐 → 수익 낮고 풀 좁은 쪽을 굳이 택할 이유 없음.

**결과**: 멀티테넌트 SaaS 채택. 운영 부담은 Cloudflare Worker 가 거의 알아서 도므로 용돈벌이 목표에 부합.

---

## ADR-002 (2026-06-01) — 코드 공유, 런타임 완전 분리

**결정**: owner(나)와 customer(고객)는 **sync core 코드만 공유**하고, 진입점·자격증명·런타임·데이터는 **완전 분리**.

**맥락**: 사용자 제약 — "내가 쓸 것과 그들이 쓰는 게 달라야 한다. 지금 내 것은 절대 망치면 안 된다."

**근거**: 둘을 한 런타임/한 resolver 에 섞으면 고객 장애·부하가 내 `framer push` 에 전이됨.
코드 경로를 분리하면 고객 쪽 노드가 내 그래프에 *존재하지 않으므로* 영향이 구조적으로 0.

**결과** (격리 4차원, `ARCHITECTURE.md` 상세):
1. 코드 경로 — `ownerResolver`(doppler만) / `customerResolver`(store만). 한 resolver 에 안 섞음.
2. 식별자 — owner 예약 ID(sisoso/mukayu/test)를 customer 가 못 가짐 (`isolation.mjs`).
3. 런타임 — 별도 Worker / 별도 Cloudflare.
4. 데이터 — owner=Doppler, customer=D1. 서로 secret 복사 안 함.
- 검증: `tenantProvider.test.mjs` 8/8 (test 8 = 서로의 테넌트를 못 봄).
- 내 코드(`framer.mjs`/`workerEnvMap.mjs`) 한 줄도 안 건드림 (additive only).

---

## ADR-003 (2026-06-01) — provider 메커니즘은 통합, owner 를 고객 풀에 넣지는 않음

**결정**: 자격증명 출처(provider)는 하나의 추상으로 **두 방식 다 포용**(Doppler / store). 그러나
**owner 를 customer 풀의 한 테넌트로 합치지는 않는다** (격리 유지).

**맥락**: "Doppler 를 고객도 쓴다면 나도 그냥 유저로 들어가면 되네? 두 방식 포용해야 하나?" 라는 질문.

**근거**:
- provider 추상 덕에 두 방식 포용은 *이미 공짜로 됨* — 더 합칠 것 없음.
- 내 Doppler 에 고객을 넣으면 내 시크릿 전체 노출 → 불가.
- 고객에게 Doppler 가입·config 세팅을 요구하면 온보딩 자살 → 고객은 store(키 붙여넣기)가 현실적.
- 나를 고객 풀에 넣으면 ADR-002("내 것 안 망침")가 깨짐. dogfooding 장점보다 격리 우선.

**결과**: provider 인터페이스 유지(포용 완료). owner=Doppler 격리, customer=store. dogfooding 단순화는 포기.

---

## ADR-005 (2026-06-01) — 모노레포 전용 repo 가 정답, 추출은 마지막 단계

**결정**: FrameSync 부품은 최종적으로 **전용 모노레포 하나(`framesync`)**에 모아야 한다.
단, 추출은 core 가 안정된 이후(ROADMAP 6단계). 지금은 `clavier-scripts/saas/` 를 씨앗으로 운영.

**맥락**: "여러 repo 를 오가며 모듈형으로 해야 할 때 어느 repo 에 두나? 전용 repo 가 필요한가?"

**근거**:
- core(platform-workers) + tenant(clavier-scripts) + 고객 부품(platform-workers) 이 흩어지면
  "어느 부품이 어느 repo 꺼냐" 가 drift 남 → 업계 표준 = 모노레포.
- core·tenant·worker·cli 가 한 제품의 부품이고 서로 의존 → npm workspace 모노레포가 맞음.
- 단, 지금 당장 옮기면: core 가 platform-workers 에서 프로덕션으로 돌고 있어서 섣불리 옮기면
  내 것 망가질 위험 + CLAUDE.md "한 번에 하나" 위반.

**목표 구조** (안정 후):
```
framesync/  ← 전용 repo
  packages/
    core/         ← platform-workers/framer-sync 에서 이사
    tenant/       ← clavier-scripts/saas/tenant 에서 이사
    ports/
    store-d1/     (고객 부품)
    store-sqlite/ (내 부품)
    worker/       (고객 프로덕션)
    cli/          (내 프로덕션 `framer` 명령)
```

**결과**: 지금은 `saas/` 씨앗 단계. core 안정 → 전용 repo 추출. 급하지 않음, ROADMAP 6단계(선택).

---

## ADR-004 (2026-06-01) — 부품 수정 = 고객 자동 업데이트, core 수정 = 양쪽 개선

**결정**: 개선은 공유, 장애만 격리.

**맥락**: "고객에 해당하는 부품을 고치면 그 고객 것도 업데이트되는 거잖아."

**근거/결과**:
- 고객 부품(`storeProvider`/`store-d1`/`customerResolver`)을 고치면 → 전 고객이 그 개선을 받음.
- 공유 core(sync 로직)를 고치면 → 내 `framer push` + 전 고객 둘 다 개선.
- 즉 내가 매일 쓰며 core 를 발전시키는 것이 곧 제품 업데이트. "어차피 내가 발전시킬 내 일" 이 그대로 사업이 됨.
- 단 core 는 한 벌이라 한쪽만 고치면 동등성 깨짐 → core 변경은 idempotency self-test 가 게이트 (CLAUDE.md 계승).
