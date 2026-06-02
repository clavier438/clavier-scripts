# FrameSync SaaS — 격리 아키텍처

> 결정: **코드는 공유(재사용 모듈), 런타임은 완전 분리.**
> owner(나)와 customer(고객)는 둘 다 프로덕션이지만, 서로의 코드 경로를 *공유하지 않는다*.
> 사용자 제약(2026-06-01): "내가 쓸 것과 그들이 쓰는 게 달라야 한다. 지금 내 것은 절대 망치면 안 된다."

---

## 왜 "둘 다 메인인데 달라야" 하는가

둘 다 프로덕션이다. 하지만 *진입점·런타임·데이터*가 다르다:

| 차원 | owner (나) | customer (고객) |
|---|---|---|
| 진입점 | `framer push` (CLI, 사람이 엔터) | Worker fetch (Airtable webhook) |
| 자격증명 출처 | Doppler (`prd`/`prd_mukayu`) | D1 `customers` 테이블 |
| 런타임 | 내 Mac / 내 Cloudflare | 별도 멀티테넌트 Worker |
| provider | `dopplerProvider` 만 | `storeProvider` 만 |
| 식별자 | `sisoso`/`mukayu`/`test` (예약) | 발급 ID (`cus_...`) |

**공유하는 것은 단 하나 — sync core(Airtable→upsert→Framer).** 나머지는 전부 다르다.

---

## 격리 4차원 (방어선)

```
1. 코드 경로 격리  ← 1차 방어 (가장 강함)
   owner 배포 = ownerResolver([dopplerProvider])      ← store 코드가 *존재하지 않음*
   customer 배포 = customerResolver([storeProvider])  ← doppler 코드가 *존재하지 않음*
   → 한 resolver 에 둘을 섞지 않는다. 코드 경로 자체가 분리됨.

2. 식별자 격리      ← 2차 방어 (defense in depth)
   reservedOwnerIds() = workerEnvMap SSOT 에서 도출.
   customer 가 'sisoso' 등 owner ID 등록 시도 → assertCustomerId 가 throw.
   guardOwnerIds(store) 가 put 단계에서 차단.

3. 런타임 격리      ← 배포 분리
   customer 는 별도 Cloudflare Worker / 별도 D1. customer 트래픽·장애가
   owner 의 `framer push` 에 닿을 경로가 없다.

4. 데이터 격리      ← 저장소 분리
   owner = Doppler + 자기 store. customer = D1 customers(tenant_id 스코프).
   서로의 secret 을 복사하지 않는다.
```

---

## "내 것 절대 안 망침" 의 구조적 증거

```
내 CLI (framer push)
  └─ ownerResolver({ env })
       └─ dopplerTenantProvider  →  Doppler env  →  Airtable → Framer
                                        (storeProvider 를 import 하지 않음)

고객 Worker
  └─ customerResolver(d1Store)
       └─ storeTenantProvider(guardOwnerIds(d1))  →  D1  →  Airtable → Framer
                                        (dopplerProvider 를 import 하지 않음)
```

두 그래프는 **core 노드만 공유하고 그 외 어떤 노드도 공유하지 않는다.**
고객 쪽 store/D1/Worker 가 어떻게 터지든, owner 그래프엔 그 노드가 없으므로 영향 0.

검증: `node saas/tenant/tenantProvider.test.mjs` → 8/8
- test 8 = "owner resolver 는 customer 를, customer resolver 는 owner 를 못 본다"

---

## core 동등성 규칙 (CLAUDE.md 계승)

core 가 한 벌이므로 **owner 와 customer 의 sync 결과는 동일해야 한다**
(CLAUDE.md "framer-sync = platform-agnostic, 한쪽만 고치면 동등성 깨짐" 그대로).
core 를 고치면 양쪽 다 영향 — 그래서 core 변경은 idempotency self-test 통과가 게이트.
provider/store 는 갈아끼워도 core 는 안 건드린다.

---

## 점진 이행 (한 번에 하나)

| 단계 | 작업 | owner 영향 |
|---|---|---|
| 1 ✅ | `saas/tenant/` 모듈 + 격리 가드 + 테스트 | 없음 (additive) |
| 2 | owner CLI 에 `ownerResolver` *옵션* 연결 (기존 경로 fallback 유지) | 무중단 |
| 3 | platform-workers 에 `store-d1` + `customerResolver` + D1 `customers` | 별도 배포 |
| 4 | 결제·온보딩(고객이 키 입력 → store.put) | 별도 |
| 5 | 안정 후 `framesync` 모노레포 추출 (선택) | 없음 |

각 단계는 owner 프로덕션을 건드리지 않거나, 건드려도 fallback 으로 무중단.
