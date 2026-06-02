// tenantStore.mjs — customer 테넌트 레코드 저장소 인터페이스 + 구현 1종(JSON 파일).
//
// owner 테넌트(sisoso/mukayu)는 store 가 필요 없다 — Doppler 가 진실 소스.
// customer 테넌트만 store 에 산다. 고객 온보딩 = store.put(...), 해지 = store.delete(...).
//
// 인터페이스를 store 별로 동일하게 둔 이유: 로컬은 JSON, 프로덕션(워커)은 D1 으로
// "갈아끼우면 그만" 이게 하기 위함. d1TenantStore 는 platform-workers 쪽에서 같은
// 시그니처로 구현하면 storeTenantProvider 가 그대로 받는다.
//
//   interface TenantStore {
//     get(id)          : Promise<Record|null>
//     put(id, record)  : Promise<void>
//     list()           : Promise<string[]>     // tenantId 배열
//     delete(id)       : Promise<void>
//   }
//
// ⚠️ 보안: customer record 는 Airtable PAT / Framer token 을 포함한다 = secret.
//   - 커밋 금지: 실제 customers.json 은 .gitignore. 예시는 customers.example.json (placeholder).
//   - 프로덕션: D1 + 컬럼 암호화 또는 Cloudflare Secrets Store 권장. 평문 JSON 은 로컬/PoC 전용.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { dirname } from "path"

/**
 * JSON 파일 1개를 { [tenantId]: record } 맵으로 쓰는 store.
 * 로컬 개발 / PoC 용. 동시 쓰기 안전성 없음 (단일 프로세스 가정).
 *
 * @param {string} path  customers.json 경로
 * @returns {{get:Function, put:Function, list:Function, delete:Function}}
 */
export function jsonTenantStore(path) {
    const load = () => {
        if (!existsSync(path)) return {}
        try { return JSON.parse(readFileSync(path, "utf8")) }
        catch (e) { throw new Error(`tenantStore: ${path} 파싱 실패 — ${e.message}`) }
    }
    const save = (map) => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify(map, null, 2) + "\n")
    }

    return {
        async get(id) {
            return load()[id] ?? null
        },
        async put(id, record) {
            const map = load()
            map[id] = { ...record, tenantId: id }
            save(map)
        },
        async list() {
            return Object.keys(load())
        },
        async delete(id) {
            const map = load()
            delete map[id]
            save(map)
        },
    }
}

/**
 * 메모리 store — 테스트용. 프로세스 끝나면 사라짐.
 * @param {Object} [seed]  { [tenantId]: record } 초기값
 */
export function memoryTenantStore(seed = {}) {
    const map = { ...seed }
    return {
        async get(id) { return map[id] ?? null },
        async put(id, record) { map[id] = { ...record, tenantId: id } },
        async list() { return Object.keys(map) },
        async delete(id) { delete map[id] },
    }
}
