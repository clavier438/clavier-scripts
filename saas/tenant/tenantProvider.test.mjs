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
import { dopplerTenantProvider, storeTenantProvider, createTenantResolver } from "./tenantProvider.mjs"
import { memoryTenantStore } from "./tenantStore.mjs"
import { redactTenant } from "./tenantConfig.mjs"

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

console.log(`\n✅ ${pass}/5 통과`)
