// tenantConfig.mjs — 한 테넌트(= 한 Framer 사이트)의 sync 에 필요한 설정 모양.
//
// 이 파일은 "데이터 모양" 만 정의한다. 어디서 가져오는지(Doppler / store / D1)는
// tenantProvider.mjs 의 책임. 그래야 provider 를 갈아끼워도 하류 코드가 동일하게 동작한다.
//
// 동기 (사용자 발화 2026-06-01):
//   "내 방식은 유지하고싶고 그걸 모듈식으로 구축 — 갈아끼우면 그만인"
//   → owner(Doppler) provider 든 customer(store) provider 든 같은 TenantConfig 를 뱉는다.
//     framer push 입장에선 출처를 몰라도 된다.

/**
 * @typedef {Object} TenantConfig
 * @property {string}  tenantId            - 고유 식별자 (owner: "sisoso"/"mukayu", customer: 발급 ID)
 * @property {"owner"|"customer"} kind     - 출처 종류 (과금/격리 정책 분기용)
 * @property {Object}  airtable
 * @property {string}  airtable.baseId     - Airtable base ID (appXXXX)
 * @property {string}  airtable.pat        - Airtable Personal Access Token (secret)
 * @property {Object}  framer
 * @property {string}  framer.url          - Framer plugin endpoint URL
 * @property {string}  framer.token        - Framer token (secret) — url 과 쌍
 * @property {Object}  [utm]               - 프로젝트 단위 UTM 일괄 적용 (선택)
 * @property {string}  [utm.source]
 * @property {string}  [utm.medium]
 * @property {string}  [utm.campaign]
 * @property {string}  [utm.term]
 * @property {string}  [utm.content]
 * @property {Object}  [meta]              - 비-운영 메타 (plan, 생성일 등). sync 로직은 안 봄.
 */

const SECRET_KEYS = new Set(["pat", "token"])

/**
 * TenantConfig 가 sync 에 쓸 수 있는 상태인지 검증.
 * 누락 필드를 모아 던진다 (한 번에 다 보여주기 — 사용자 피드백 "한 번에 일괄").
 * @param {Partial<TenantConfig>} cfg
 * @returns {TenantConfig}
 */
export function assertTenantConfig(cfg) {
    const missing = []
    if (!cfg) throw new Error("tenantConfig: null/undefined")
    if (!cfg.tenantId) missing.push("tenantId")
    if (cfg.kind !== "owner" && cfg.kind !== "customer") missing.push('kind ("owner"|"customer")')
    if (!cfg.airtable?.baseId) missing.push("airtable.baseId")
    if (!cfg.airtable?.pat)    missing.push("airtable.pat")
    if (!cfg.framer?.url)      missing.push("framer.url")
    if (!cfg.framer?.token)    missing.push("framer.token")
    if (missing.length) {
        throw new Error(`tenantConfig(${cfg.tenantId ?? "?"}) 불완전 — 누락: ${missing.join(", ")}`)
    }
    return /** @type {TenantConfig} */ (cfg)
}

/**
 * 로그/디버그용 — secret 을 마스킹한 복사본. 절대 raw config 를 로그에 찍지 말 것.
 * @param {TenantConfig} cfg
 */
export function redactTenant(cfg) {
    const walk = (obj) => {
        if (obj == null || typeof obj !== "object") return obj
        const out = Array.isArray(obj) ? [] : {}
        for (const [k, v] of Object.entries(obj)) {
            if (SECRET_KEYS.has(k) && typeof v === "string") {
                out[k] = v ? `${v.slice(0, 3)}…(${v.length})` : ""
            } else {
                out[k] = walk(v)
            }
        }
        return out
    }
    return walk(cfg)
}
