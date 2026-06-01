// tenantProvider.mjs — 테넌트 해석(resolve)을 인터페이스 뒤로 숨긴다.
//
// 이게 이 모듈의 심장. framer push 는 "tenantId 주면 TenantConfig 받는다" 만 안다.
// 출처(Doppler / store / D1)는 provider 가 책임진다 → 갈아끼우면 하류 무변화.
//
//   interface TenantProvider {
//     resolve(tenantId) : Promise<TenantConfig|null>   // 못 찾으면 null (에러 아님)
//     list()            : Promise<string[]>
//   }
//
// 두 구현:
//   1) dopplerTenantProvider — owner 방식. 기존 workerEnvMap.mjs(SSOT) 재사용.
//      값은 doppler run 이 주입한 process.env 에서 읽는다 (framer.mjs 와 동일 경로).
//      → 사용자의 현재 방식을 한 줄도 안 바꾼다. 그냥 같은 env 를 TenantConfig 모양으로 감쌀 뿐.
//   2) storeTenantProvider — customer 방식. tenantStore 에서 레코드를 읽어 TenantConfig 로.
//
// createTenantResolver([owner, store]) — 앞에서부터 시도, 첫 hit 반환.
//   "갈아끼우면 그만" = 이 배열을 바꾸거나 순서를 바꾸면 정책이 바뀐다.

import { getWorkerEnv, listWorkerEnvs } from "../../tools/lib/workerEnvMap.mjs"
import { assertTenantConfig } from "./tenantConfig.mjs"

// owner 테넌트가 doppler run 으로 주입받는 env 키 이름.
// ⚠️ 본인 Doppler config(prd / prd_mukayu)의 실제 키 이름과 일치시킬 것.
//    framer.mjs 가 이미 AIRTABLE_BASE_ID / AIRTABLE_PAT 를 읽으므로 그 둘은 확정,
//    Framer URL+Token 키 이름만 본인 config 에 맞게 OWNER_ENV_KEYS 로 덮어쓰면 됨.
const DEFAULT_ENV_KEYS = {
    airtableBaseId: "AIRTABLE_BASE_ID",
    airtablePat:    "AIRTABLE_PAT",
    framerUrl:      "FRAMER_PLUGIN_URL",
    framerToken:    "FRAMER_TOKEN",
    utmSource:      "UTM_SOURCE",
    utmMedium:      "UTM_MEDIUM",
    utmCampaign:    "UTM_CAMPAIGN",
    utmTerm:        "UTM_TERM",
    utmContent:     "UTM_CONTENT",
}

/**
 * owner provider — 현재 사용자 방식(Doppler) 그대로.
 * tenantId 가 WORKER_ENV_MAP 에 있으면(sisoso/mukayu/test) env 에서 값을 모아 TenantConfig 로.
 *
 * 주의: 값은 "지금 프로세스에 주입된 env" 에서 읽는다. 즉 호출 시점에 그 테넌트의
 *       Doppler config 가 주입돼 있어야 한다(framer.mjs 의 doppler run self-respawn 과 동일 전제).
 *       서로 다른 owner 테넌트를 한 프로세스에서 동시에 resolve 하려면 store 방식을 쓰거나
 *       config 별로 프로세스를 나눠야 한다 — owner 방식의 의도된 한계(= 단순함).
 *
 * @param {Object} [opts]
 * @param {Object} [opts.env]      - 기본 process.env (테스트 주입용)
 * @param {Object} [opts.envKeys]  - DEFAULT_ENV_KEYS 덮어쓰기
 */
export function dopplerTenantProvider(opts = {}) {
    const env = opts.env ?? process.env
    const keys = { ...DEFAULT_ENV_KEYS, ...(opts.envKeys ?? {}) }

    return {
        async resolve(tenantId) {
            if (!getWorkerEnv(tenantId)) return null   // owner 명단에 없음 → 다음 provider 로

            const utm = {}
            if (env[keys.utmSource])   utm.source   = env[keys.utmSource]
            if (env[keys.utmMedium])   utm.medium   = env[keys.utmMedium]
            if (env[keys.utmCampaign]) utm.campaign = env[keys.utmCampaign]
            if (env[keys.utmTerm])     utm.term     = env[keys.utmTerm]
            if (env[keys.utmContent])  utm.content  = env[keys.utmContent]

            return assertTenantConfig({
                tenantId,
                kind: "owner",
                airtable: { baseId: env[keys.airtableBaseId], pat: env[keys.airtablePat] },
                framer:   { url: env[keys.framerUrl], token: env[keys.framerToken] },
                ...(Object.keys(utm).length ? { utm } : {}),
                meta: { source: "doppler" },
            })
        },
        async list() {
            return listWorkerEnvs().map(e => e.name)
        },
    }
}

/**
 * customer provider — store 레코드를 TenantConfig 로.
 * store record 모양은 TenantConfig 와 동일하되 kind 는 강제로 "customer".
 *
 * @param {{get:Function, list:Function}} store  tenantStore.mjs 의 store
 */
export function storeTenantProvider(store) {
    if (!store?.get) throw new Error("storeTenantProvider: store(get/list) 필요")
    return {
        async resolve(tenantId) {
            const rec = await store.get(tenantId)
            if (!rec) return null
            return assertTenantConfig({
                ...rec,
                tenantId,
                kind: "customer",
                meta: { ...(rec.meta ?? {}), source: "store" },
            })
        },
        async list() {
            return store.list ? store.list() : []
        },
    }
}

/**
 * resolver — provider 들을 순서대로 시도, 첫 hit 반환. 전부 miss 면 에러.
 * provider 배열을 바꾸는 것이 곧 정책 변경 ("갈아끼우면 그만").
 *
 * @param {Array<{resolve:Function, list:Function}>} providers
 */
export function createTenantResolver(providers) {
    if (!Array.isArray(providers) || providers.length === 0) {
        throw new Error("createTenantResolver: provider 최소 1개 필요")
    }
    return {
        async resolve(tenantId) {
            for (const p of providers) {
                const cfg = await p.resolve(tenantId)
                if (cfg) return cfg
            }
            throw new Error(`tenant 못 찾음: ${tenantId} (provider ${providers.length}개 모두 miss)`)
        },
        async list() {
            const all = await Promise.all(providers.map(p => p.list?.() ?? []))
            return [...new Set(all.flat())]
        },
    }
}
