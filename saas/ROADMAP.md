# FrameSync — 로드맵 & 인수인계 지점

> 단계별 작업. 한 번에 하나씩(CLAUDE.md). 각 단계의 owner 영향과 "어느 repo 에서" 를 명시.
> 새로 이어받으면 `[ ]` 중 가장 위 미완료부터.

## 범례
- ✅ 완료 / ⬜ 미착수 / 🔶 진행중
- owner 영향: 내 프로덕션(`framer push`)에 미치는 위험.

---

## 1. 멀티테넌트 tenant 모듈 ✅
- **repo**: clavier-scripts (`saas/tenant/`)
- **owner 영향**: 없음 (additive only)
- 산출물: tenantConfig / tenantStore / tenantProvider / ports / isolation + 테스트 8/8.
- 격리(ADR-002) 코드로 강제.

## 2. owner CLI 에 ownerResolver 옵션 연결 ⬜
- **repo**: clavier-scripts (`tools/framer.mjs`)
- **owner 영향**: ★ 처음으로 내 프로덕션 코드를 만짐 → **신중.**
- 방법: 기존 경로를 그대로 두고 `ownerResolver` 를 *옵션*으로만 추가. 실패 시 기존 경로로 fallback → 무중단.
- 게이트: `framer push` 동작이 1바이트도 안 바뀌는지 stage1_cache hash 비교(CLAUDE.md 동등성 검증).
- ⚠️ 이 단계는 사용자 명시 승인 후 진행 (제약: "내 것 절대 안 망침").

## 3. 고객 부품 — D1 store + 멀티테넌트 Worker ⬜  ← 인수인계 핵심
- **repo**: **platform-workers** (이 repo 아님 — 여기 환경엔 클론 안 됨)
- **owner 영향**: 없음 (별도 배포)
- 할 일:
  - `store-d1`: `tenantStore` 인터페이스(get/put/list/delete)의 D1 구현. `customers` 테이블(tenant_id PK + airtable/framer/utm 컬럼, secret 암호화).
  - `customerResolver(d1Store)` 를 Worker fetch handler 에 연결 (URL path 또는 헤더로 tenantId 추출).
  - 기존 framer-sync core(`syncCollection` 등) 를 tenantId 스코프로 호출. core 는 안 고침.
  - 테넌트별 상태 격리: worker_state 키에 `t:{tenantId}:` prefix 또는 D1 컬럼.
- 참고: `saas/tenant/ports.mjs` 의 SyncStorePort 계약을 그대로 만족시키면 됨.

## 4. 온보딩 + 결제 ⬜
- **repo**: 별도(랜딩/대시보드) 또는 Worker
- 고객이 Airtable 키 + Framer 토큰 입력 → `store.put(tenantId, config)` (자동 `guardOwnerIds` 가드).
- 결제: 구독(Stripe/Lemon Squeezy 등). 랜딩 가격은 임시($49/$149) — 시장 검증 후 확정.

## 5. 랜딩/마케팅 ⬜
- `landing/index.html` 예시 기반. 포지셔닝: "공식 플러그인이 못 하는 일괄·자동·UTM".
- 타깃: Framer 로 사이트 운영하는 마케터/에이전시.

## 6. (선택) framesync 모노레포 추출 ⬜
- core/tenant/ports/store-*/worker/cli 를 npm workspace 패키지로. `README.md` 구조 참고.
- core 가 충분히 안정된 후. 급하지 않음.

---

## 인수인계 메모

- **지금 막힌 곳**: 3단계는 platform-workers 에 있어야 함. 이 web 세션엔 그 repo 가 없어 여기서 못 함.
  → platform-workers 가 있는 환경(Mac/OCI)에서 `saas/tenant/` 를 참조하며 이어가기.
- **절대 규칙**: 2단계 전까지 `framer.mjs`/`workerEnvMap.mjs` 안 건드림. 2단계도 fallback 필수.
- **재사용 원칙**: 새 코드는 leaf 모듈(core/tenant/ports)에 의존만, 거꾸로 의존 금지(클린아키텍처).
