// tenantProvider.test.mjs — 의존성 0 자체 테스트 (node 로 직접 실행).
//
//   node saas/tenant/tenantProvider.test.mjs
//
// 검증:
//   1) owner provider 가 env 를 TenantConfig 로 감싼다 (현재 방식 보존).
//   2) store provider 가 customer 레코드를 읽는다.
//   3) resolver 가 owner → store 순서로 첫 hit 를 반환한다.
//   4) 둘 다 miss 면 에러.
//   5) redact 가 secret 을 마스킹한다.

import assert from "node:assert/strict"
import {
    dopplerTenantProvider, storeTenantProvider, createTenantResolver,
    ownerResolver, customerResolver,
} from "./tenantProvider.mjs"
import { memoryTenantStore } from "./tenantStore.mjs"
import { redactTenant } from "./tenantConfig.mjs"
import { assertCustomerId, reservedOwnerIds, guardOwnerIds } from "./isolation.mjs"

let pass = 0
const ok = (name) => { console.log(`  ✓ ${name}`); pass++ }

// ── 1) owner provider — env 주입 시뮬레이션 (sisoso 는 WORKER_ENV_MAP 에 존재) ──
const fakeEnv = {
    AIRTABLE_BASE_ID: "appOWNER123",
    AIRTABLE_PAT: "patOWNERsecret",
    FRAMER_PLUGIN_URL: "https://owner.workers.dev",
    FRAMER_TOKEN: "ownerTokenSecret",
    UTM_SOURCE: "owner-src",
}
const owner = dopplerTenantProvider({ env: fakeEnv })
const ownerCfg = await owner.resolve("sisoso")
assert.equal(ownerCfg.kind, "owner")
assert.equal(ownerCfg.airtable.baseId, "appOWNER123")
assert.equal(ownerCfg.framer.token, "ownerTokenSecret")
assert.equal(ownerCfg.utm.source, "owner-src")
assert.equal(await owner.resolve("unknown_id"), null)   // 명단 밖 → null
ok("owner provider: env → TenantConfig, 명단 밖은 null")

// ── 2) store provider — customer 레코드 ──
const store = memoryTenantStore({
    cus_x: {
        airtable: { baseId: "appCUST", pat: "patCUSTsecret" },
        framer: { url: "https://cust.workers.dev", token: "custToken" },
    },
})
const customer = storeTenantProvider(store)
const custCfg = await customer.resolve("cus_x")
assert.equal(custCfg.kind, "customer")
assert.equal(custCfg.airtable.baseId, "appCUST")
assert.equal(await customer.resolve("nope"), null)
ok("store provider: 레코드 → TenantConfig(kind=customer)")

// ── 3) resolver — owner 우선, 그다음 store ──
const resolver = createTenantResolver([owner, customer])
assert.equal((await resolver.resolve("sisoso")).kind, "owner")
assert.equal((await resolver.resolve("cus_x")).kind, "customer")
const listed = await resolver.list()
assert.ok(listed.includes("sisoso") && listed.includes("cus_x"))
ok("resolver: owner → store 순서, list 합집합")

// ── 4) 전부 miss → 에러 ──
await assert.rejects(() => resolver.resolve("ghost_tenant"), /못 찾음/)
ok("resolver: 전부 miss 시 에러")

// ── 5) redact — secret 마스킹 ──
const red = redactTenant(custCfg)
assert.ok(red.airtable.pat.startsWith("pat") && red.airtable.pat.includes("…"))
assert.ok(!JSON.stringify(red).includes("patCUSTsecret"))
ok("redact: secret 마스킹 (raw secret 노출 없음)")

// ── 6) 격리: owner 예약 ID 는 customer 가 못 가짐 ──
assert.ok(reservedOwnerIds().has("sisoso"))
assert.throws(() => assertCustomerId("sisoso"), /격리 위반/)
assert.equal(assertCustomerId("cus_ok"), "cus_ok")
ok("격리: owner 예약 ID(sisoso)를 customer 로 등록 거부")

// ── 7) 격리: guardOwnerIds store 가 put 단계에서 침범 차단 ──
const guarded = guardOwnerIds(memoryTenantStore())
await assert.rejects(
    () => guarded.put("mukayu", { airtable: {}, framer: {} }),
    /격리 위반/,
)
ok("격리: guardOwnerIds store.put 이 owner ID 침범 차단")

// ── 8) 배포 격리: ownerResolver 는 customer 를, customerResolver 는 owner 를 못 본다 ──
const ownerOnly = ownerResolver({ env: fakeEnv })
assert.equal((await ownerOnly.resolve("sisoso")).kind, "owner")
await assert.rejects(() => ownerOnly.resolve("cus_x"), /못 찾음/)   // store 경로 없음

const custStore = memoryTenantStore({
    cus_y: { airtable: { baseId: "appY", pat: "patY" }, framer: { url: "u", token: "t" } },
})
const custOnly = customerResolver(custStore)
assert.equal((await custOnly.resolve("cus_y")).kind, "customer")
await assert.rejects(() => custOnly.resolve("sisoso"), /못 찾음/)   // doppler 경로 없음
ok("배포 격리: owner/customer resolver 가 서로의 테넌트를 못 본다")

console.log(`\n✅ ${pass}/8 통과`)
