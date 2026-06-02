// ports.mjs — 모듈 경계(seam) 선언. "모든 것이 재사용 가능한 모듈" 의 계약서.
//
// 사용자 원칙 (2026-06-01): "내것과 그렇지 않은것 둘 다 프로덕션. 모든 것이 재사용 가능한 모듈."
//
// framer-sync 는 이미 platform-agnostic (CLAUDE.md: "use case 동일, store 인터페이스만 D1↔SQLite").
// 테넌시도 같은 정신으로 — 아래 3개 port 를 어댑터로 갈아끼우면 owner 와 customer 가
// "같은 core" 위에서 둘 다 프로덕션으로 돈다.
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │  core sync (platform-workers/framer-sync) — 한 벌, 불변      │
//   │    Airtable → upsert → Framer ManagedCollection             │
//   └───────▲──────────────────▲──────────────────▲───────────────┘
//           │                  │                  │
//      TenantPort          SyncStorePort      RunnerPort
//      (누구의 키)          (상태 어디)         (언제/어떻게 트리거)
//           │                  │                  │
//   ┌───────┴──────┐   ┌───────┴──────┐   ┌───────┴──────┐
//   │ owner:Doppler│   │ owner:SQLite │   │ owner: CLI   │
//   │ cust :store  │   │ cust :D1     │   │ cust : webhook│
//   └──────────────┘   └──────────────┘   └──────────────┘
//
// 이 파일은 각 port 가 만족해야 할 모양을 런타임 검증으로 박는다 (덕타이핑 명시화).
// 실제 어댑터는 각자 위치에 산다 — tenant 어댑터는 tenantProvider.mjs, store 어댑터는
// platform-workers(D1)/framer.mjs(SQLite), runner 는 worker fetch handler / CLI.

/**
 * TenantPort — tenantId → 그 테넌트의 자격증명/설정.
 * @typedef {Object} TenantPort
 * @property {(tenantId:string)=>Promise<import("./tenantConfig.mjs").TenantConfig|null>} resolve
 * @property {()=>Promise<string[]>} list
 */

/**
 * SyncStorePort — sync 상태(매핑/해시/init flag/캐시) 저장소.
 * framer-sync 가 이미 정의한 인터페이스와 동형이어야 함 (getWorkerState/setWorkerState 등).
 * 테넌트별 격리 = key prefix `t:{tenantId}:` 또는 D1 의 tenant_id 컬럼.
 * @typedef {Object} SyncStorePort
 * @property {(key:string)=>Promise<string|null>} get
 * @property {(key:string,val:string)=>Promise<void>} set
 */

/**
 * RunnerPort — sync 를 언제/어떻게 트리거하는가.
 *   owner   : CLI (`framer push`) — 사람이 엔터.
 *   customer: Cloudflare Worker fetch — Airtable webhook 이 트리거.
 * @typedef {Object} RunnerPort
 * @property {(tenantId:string)=>Promise<{updated:number,created:number,skipped:number}>} runSync
 */

const need = (obj, methods, portName) => {
    if (!obj || typeof obj !== "object") throw new Error(`${portName}: 객체 아님`)
    const missing = methods.filter(m => typeof obj[m] !== "function")
    if (missing.length) throw new Error(`${portName}: 메서드 누락 — ${missing.join(", ")}`)
    return obj
}

/** TenantPort 계약 검증. resolver/provider 둘 다 이걸 만족한다. */
export const asTenantPort   = (o) => need(o, ["resolve", "list"], "TenantPort")
/** SyncStorePort 계약 검증. JSON/SQLite/D1 store 어댑터가 만족. */
export const asSyncStorePort = (o) => need(o, ["get", "set"], "SyncStorePort")
/** RunnerPort 계약 검증. CLI runner / worker handler 가 만족. */
export const asRunnerPort   = (o) => need(o, ["runSync"], "RunnerPort")
