// isolation.mjs — owner ↔ customer 격리 불변식. "내 것 절대 안 망침" 을 코드로 강제.
//
// 사용자 원칙 (2026-06-01): "내가 쓸 것과 그들이 쓰는 게 달라야 한다. 지금 내 것은 절대 망치면 안 된다."
//
// 격리 4차원:
//   1) 코드 경로 — 각 배포가 자기 provider 만 조립 (ownerResolver / customerResolver).
//                  owner 배포엔 store 코드가, customer 배포엔 doppler 코드가 *존재하지 않음*.
//   2) 식별자   — owner ID(sisoso/mukayu/test)는 예약어. customer 가 절대 못 가짐 (이 파일).
//   3) 런타임   — 별도 Worker / 별도 Cloudflare 배포. customer 트래픽이 owner 를 못 건드림.
//   4) 데이터   — owner=Doppler+자기 store, customer=D1 customers(tenant_id 스코프).
//
// 이 파일은 2번(식별자 격리)을 런타임 가드로 박는다. defense in depth — 1번이 1차 방어,
// 이건 customer store 가 실수로 owner ID 를 담는 네임스페이스 오염을 막는 2차 방어선.

import { listWorkerEnvs } from "../../tools/lib/workerEnvMap.mjs"

/**
 * owner 예약 ID 집합. workerEnvMap(SSOT)에서 도출 — 하드코딩 0.
 * owner 명단이 늘면(새 워커) 자동으로 예약어도 늘어난다.
 * @returns {Set<string>}
 */
export function reservedOwnerIds() {
    return new Set(listWorkerEnvs().map(e => e.name))
}

/**
 * customer tenantId 검증 — owner 예약 ID 면 거부.
 * customer 등록(store.put) 경로에서 호출. 침범 시 즉시 throw.
 * @param {string} tenantId
 * @returns {string} 통과한 tenantId
 */
export function assertCustomerId(tenantId) {
    if (!tenantId || typeof tenantId !== "string") {
        throw new Error("assertCustomerId: tenantId 문자열 필요")
    }
    if (reservedOwnerIds().has(tenantId)) {
        throw new Error(
            `격리 위반: '${tenantId}' 는 owner 예약 ID — customer 로 등록 불가. ` +
            `(reservedOwnerIds: ${[...reservedOwnerIds()].join(", ")})`,
        )
    }
    return tenantId
}

/**
 * store 를 감싸 put 시 owner ID 침범을 막는다. 기존 store 인터페이스 보존(투명 래퍼).
 * customer 배포는 raw store 대신 이 가드 store 를 쓴다.
 * @param {{get:Function, put:Function, list:Function, delete:Function}} store
 */
export function guardOwnerIds(store) {
    return {
        ...store,
        async put(id, record) {
            assertCustomerId(id)
            return store.put(id, record)
        },
    }
}
