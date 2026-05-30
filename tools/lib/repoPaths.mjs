// repoPaths.mjs — sibling-first repo discovery (environment-peer 모델)
//
// 클린아키텍처 목표 (DECISIONS.md "environment-peer 모델", 2026-05-03~):
//   Layer 1 도구는 어느 peer 환경(Mac / OCI / web / 미래 서버)에서
//   호출되든 관련 repo (clavier-hq, platform-workers) 를 자동 탐색해야 함.
//
// 탐색 우선순위 (절대경로 하드코딩 0 — 자기 위치에서 도출):
//   1. 명시 env var (예: CLAVIER_HQ, PLATFORM_WORKERS)
//   2. sibling 디렉토리 — 이 repo 의 부모에서 같은 이름 (예: ../clavier-hq, ../platform-workers)
//   3. 못 찾음 → null
//
// import.meta.url 을 통해 호출 파일 기준 경로 산출. 이 lib 는 tools/lib/ 에 있으므로
// 이 repo 의 root 는 ../../ (lib → tools → repo root).

import { existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(LIB_DIR, "..", "..")
const REPO_PARENT = join(REPO_ROOT, "..")

/**
 * Find a related repo by name.
 * @param {string} name        - repo 디렉토리 이름 (e.g. "clavier-hq")
 * @param {string} envVar      - env var override 이름 (e.g. "CLAVIER_HQ")
 * @returns {string|null}      - 절대 경로 또는 null
 */
export function findRepo(name, envVar) {
    if (envVar && process.env[envVar]) return process.env[envVar]

    const sibling = join(REPO_PARENT, name)
    if (existsSync(sibling)) return sibling

    return null
}

/**
 * Convenience accessors for the standard repos.
 */
export const findClavierHq       = () => findRepo("clavier-hq",       "CLAVIER_HQ")
export const findPlatformWorkers = () => findRepo("platform-workers", "PLATFORM_WORKERS")

/** platform-workers/framer-sync (env FRAMER_SYNC_DIR override). */
export const findFramerSync = () => {
    if (process.env.FRAMER_SYNC_DIR) return process.env.FRAMER_SYNC_DIR
    const pw = findPlatformWorkers()
    return pw ? join(pw, "framer-sync") : null
}
