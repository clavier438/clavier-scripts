# FrameSync SaaS — Mac 인수인계

> 이 문서 하나만 읽으면 됩니다. 다른 파일 열 필요 없음.
> 목표: framer-sync 를 유료 고객도 쓸 수 있는 서비스로 완성하기.

---

## 지금까지 한 것 (web 세션, 완료)

### 만들어진 것

| 위치 | 내용 |
|---|---|
| `saas/tenant/tenantConfig.mjs` | TenantConfig 모양 + 검증 + secret 마스킹 |
| `saas/tenant/tenantStore.mjs` | customer 레코드 저장소 인터페이스 (JSON/memory) |
| `saas/tenant/tenantProvider.mjs` | **핵심** — `ownerResolver` (Doppler) / `customerResolver` (D1) |
| `saas/tenant/isolation.mjs` | owner 예약 ID 보호 (sisoso/mukayu/test 를 고객이 못 가짐) |
| `saas/tenant/ports.mjs` | 모듈 경계 계약 |
| `saas/cli/framesync-admin.mjs` | 고객 수동 등록/조회/삭제 CLI |
| `landing/index.html` | 랜딩 페이지 (Lemon Squeezy 링크 자리 있음) |
| `landing/wrangler.toml` | Pages 배포용 |

### D1 데이터베이스 (이미 생성됨, 프로덕션)

```
이름: framesync-customers
ID:   76bf5389-0f1a-46a9-bc3e-2c0fde6f7d64
테이블: customers (tenant_id PK, airtable_base, airtable_pat,
                   framer_url, framer_token, utm_*, plan, active,
                   created_at, notes)
```

### 테스트

```bash
node saas/tenant/tenantProvider.test.mjs  # → 8/8 통과
```

---

## 격리 원칙 (절대 깨지 말 것)

내 것(owner)과 고객(customer)은 **코드 경로가 완전히 분리**됩니다.

```
내 framer push → ownerResolver → dopplerProvider 만 → 내 Doppler 만
고객 Worker  → customerResolver → storeProvider(D1) 만 → 고객 D1 만
```

한 resolver 에 둘을 절대 섞지 않습니다.
`framer.mjs` 와 `workerEnvMap.mjs` 는 이번 작업에서 **한 줄도 건드리지 않습니다.**

---

## 지금 해야 할 것 (Mac 에서)

### 위치

```bash
cd ~/dev/clavier/clavier-scripts          # 또는 본인 클론 위치
git fetch origin
git checkout claude/framer-sync-multitenant
```

```bash
cd ~/dev/clavier/platform-workers         # framer-sync 워커 위치
```

---

### Step 1 — D1 store 어댑터 작성

`platform-workers/framer-sync/` 안에 파일 하나 추가:

**`src/tenantStoreD1.mjs`** (또는 `.ts` — 워커 언어에 맞게)

```js
// D1 을 tenantStore 인터페이스로 감싼 어댑터.
// clavier-scripts/saas/tenant/tenantStore.mjs 의 jsonTenantStore 와
// 동일한 인터페이스(get/put/list/delete)를 만족해야 한다.
//
// D1 바인딩 이름: FRAMESYNC_CUSTOMERS_DB (wrangler.toml 에 추가)

export function d1TenantStore(db) {   // db = env.FRAMESYNC_CUSTOMERS_DB
    return {
        async get(id) {
            const row = await db.prepare(
                "SELECT * FROM customers WHERE tenant_id = ? AND active = 1"
            ).bind(id).first()
            if (!row) return null
            return {
                tenantId:    row.tenant_id,
                airtable:    { baseId: row.airtable_base, pat: row.airtable_pat },
                framer:      { url: row.framer_url, token: row.framer_token },
                utm: {
                    source:   row.utm_source,
                    medium:   row.utm_medium,
                    campaign: row.utm_campaign,
                },
                meta: { plan: row.plan, createdAt: row.created_at },
            }
        },
        async put(id, record) {
            await db.prepare(`
                INSERT OR REPLACE INTO customers
                  (tenant_id, airtable_base, airtable_pat,
                   framer_url, framer_token,
                   utm_source, utm_medium, utm_campaign,
                   plan, notes, active)
                VALUES (?,?,?,?,?,?,?,?,?,?,1)
            `).bind(
                id,
                record.airtable?.baseId, record.airtable?.pat,
                record.framer?.url,      record.framer?.token,
                record.utm?.source,      record.utm?.medium, record.utm?.campaign,
                record.meta?.plan ?? "starter",
                record.meta?.notes ?? ""
            ).run()
        },
        async list() {
            const { results } = await db.prepare(
                "SELECT tenant_id FROM customers WHERE active = 1"
            ).all()
            return results.map(r => r.tenant_id)
        },
        async delete(id) {
            await db.prepare(
                "UPDATE customers SET active = 0 WHERE tenant_id = ?"
            ).bind(id).run()
        },
    }
}
```

---

### Step 2 — wrangler.toml 에 D1 바인딩 추가

`platform-workers/framer-sync/wrangler.toml` 에 추가:

```toml
[[d1_databases]]
binding  = "FRAMESYNC_CUSTOMERS_DB"
database_name = "framesync-customers"
database_id   = "76bf5389-0f1a-46a9-bc3e-2c0fde6f7d64"
```

멀티 env 구조면 `[env.saas]` 섹션으로 분리해도 됩니다.

---

### Step 3 — 멀티테넌트 Worker 엔트리 추가

framer-sync 의 기존 `index.ts` (또는 `index.mjs`) 에 새 라우트 추가.
**기존 라우트는 절대 건드리지 않습니다.** 새 경로만 추가.

```
POST /saas/sync/:tenantId   ← 고객 webhook 수신 + sync 트리거
GET  /saas/health           ← 고객 Worker 살아있나 확인용
```

라우트 핸들러 구조:

```js
import { d1TenantStore } from "./tenantStoreD1.mjs"
import { customerResolver } from "../../clavier-scripts/saas/tenant/tenantProvider.mjs"
// 또는 로컬 복사 — 아래 참고

async function handleSaasSync(request, env, tenantId) {
    // 1. tenant 설정 조회
    const store    = d1TenantStore(env.FRAMESYNC_CUSTOMERS_DB)
    const resolver = customerResolver(store)
    const cfg      = await resolver.resolve(tenantId)   // 못 찾으면 throw

    // 2. 기존 sync 함수 재사용 (airtable → framer)
    //    현재 framer-sync 가 사용하는 syncCollection 또는 동등 함수를 호출.
    //    cfg.airtable.baseId, cfg.airtable.pat, cfg.framer.url, cfg.framer.token 전달.
    await runSync({
        airtableBaseId: cfg.airtable.baseId,
        airtablePat:    cfg.airtable.pat,
        framerUrl:      cfg.framer.url,
        framerToken:    cfg.framer.token,
    })

    return new Response(JSON.stringify({ ok: true, tenantId }), {
        headers: { "Content-Type": "application/json" }
    })
}
```

`runSync` = 기존 framer-sync 의 sync 로직. 함수 이름은 현재 워커 코드에서 확인.

---

### Step 4 — tenantProvider 공유 방법 결정

`saas/tenant/` 모듈을 platform-workers 에서 쓰는 방법 두 가지:

**A. 상대 경로 import (형제 클론 구조)**
```js
import { customerResolver } from "../../clavier-scripts/saas/tenant/tenantProvider.mjs"
```
- Mac 콜로니 (`~/dev/clavier/`) 구조면 바로 됨.
- OCI / CI 에서도 형제 클론이면 zero-config.

**B. 로컬 복사 (가장 단순, 일단 빠르게)**
```bash
cp -r clavier-scripts/saas/tenant platform-workers/framer-sync/src/tenant
```
- 나중에 변경 시 양쪽 동기화 필요. 단기 MVP 에는 괜찮음.

권장: 지금은 **B (복사)** 로 빠르게. 모노레포 추출 시 자연히 해결됨.

---

### Step 5 — 배포 + 검증

```bash
# clavier-scripts 에서 고객 테스트 등록
doppler run -- node saas/cli/framesync-admin.mjs add cus_test \
  --base appTEST --pat patTEST \
  --framer-url https://test.workers.dev --framer-token testTok \
  --plan starter --notes "로컬 테스트"

# platform-workers 에서 배포
cd platform-workers/framer-sync
doppler run -- wrangler deploy

# sync 테스트
curl -X POST https://<worker-url>/saas/sync/cus_test
# → {"ok":true,"tenantId":"cus_test"} 나오면 성공
```

---

### Step 6 — 랜딩 + Lemon Squeezy 연결 (별도 진행 중)

`saas/SETUP_GUIDE.md` 에 30분 SOP 있음.
Lemon Squeezy URL 2개 나오면:

```
landing/index.html 상단 <script> 안
LS_STARTER_URL = "https://YOUR_STORE.lemonsqueezy.com/buy/STARTER_ID"  ← 교체
LS_AGENCY_URL  = "https://YOUR_STORE.lemonsqueezy.com/buy/AGENCY_ID"   ← 교체
```

배포:
```bash
cd landing/
wrangler pages deploy . --project-name framesync
```

---

## 완료 기준

- [ ] `/saas/sync/:tenantId` 로 POST 하면 고객 Airtable → Framer sync 됨
- [ ] `framer push` (내 것) 는 여전히 정확히 동일하게 작동
- [ ] `framesync-admin list` 로 등록된 고객 조회됨
- [ ] 랜딩 페이지 live + CTA 버튼이 결제 링크로 연결됨

---

## 브랜치

```
repo:   clavier438/clavier-scripts
branch: claude/framer-sync-multitenant
PR:     #69
```

이 브랜치에 모든 작업 커밋. 완료 후 main 머지.
