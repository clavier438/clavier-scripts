/**
 * freshness.mjs — 모든 .mjs tool 의 첫 import.
 *
 * SSOT 의 두 번째 강제 장치 (pre-commit + post-commit 에 이어):
 *   "stale 로컬 코드로 실행" 이라는 상태 자체가 존재할 수 없게 한다.
 *
 * 검사 대상 (TRACKED):
 *   - scripts repo (자기 자신, lib/ 가 사는 곳)
 *   - platform-workers (findPlatformWorkers — sibling-first 탐색)
 *     framer.mjs / workerCtl.mjs 가 호출하는 cli.ts 가 사는 곳.
 *     검사 안 하면 scripts 만 fresh 인데 정작 실행되는 워커 코드는 stale 한 함정.
 *
 * 호출 시 동작 (repo 별):
 *   - branch == main:
 *       fetch origin main
 *       behind only  → ff-only pull, 한 줄 알림
 *       ahead 있음   → 빨간 에러 + exit 2 (main 직접 commit 은 pre-commit 으로 차단되므로
 *                      이 상태는 정상이 아님; 사용자 수동 조사 필요)
 *       이미 동기    → 침묵 통과
 *       offline      → 노란 경고 + 통과
 *   - branch != main (scripts repo):
 *       CLAVIER_TEST_BRANCH=1 → 노란 경고만 하고 통과 (명시적 테스트 모드)
 *       그 외 → main checkout + ff-only pull 후 재실행 (main 이외 경로 완전 차단)
 *       offline → 노란 경고 + 통과
 *   - branch != main (platform-workers 등):
 *       origin/main 보다 뒤처지면 노란 경고만 (블록 X)
 *
 * 한 프로세스에 한 번만 수행 (env guard). 자식 프로세스에도 전파됨.
 * `CLAVIER_LOCAL_DEV=1` 으로 dev-escape 가능 (의도적 stale 실행).
 * git hook 내부 (GIT_DIR set) 에서는 skip — 재귀 방지.
 */

import { execSync } from "child_process"
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"
import { setDefaultResultOrder } from "node:dns"
import { findPlatformWorkers } from "./repoPaths.mjs"

// ── IPv4-first 시스템 invariant ────────────────────────────────────────────
// Node 22 의 undici fetch 는 happy-eyeballs autoSelectFamily 가 macOS 에서 신뢰 못 함.
// 시스템 IPv6 라우팅이 죽었을 때 (Wi-Fi/VPN/ISP 사고로 흔히 일어남)
// fetch 가 즉시 ETIMEDOUT 으로 떨어지고 IPv4 로 fallback 안 함. curl 은 됨.
//
// freshness.mjs 가 모든 .mjs tool 의 첫 import (pre-commit hook (2) 가 강제) →
// 여기 한 줄로 "모든 도구의 모든 fetch 가 IPv4 부터" invariant 가 박힘. drift 불가.
//
// 이력: 2026-05-27 copy.mjs v26 push 가 같은 사고로 실패해 거기에 박혔으나
//       workerCtl 까지 전파 안 돼 같은 날 두 번째로 사용자가 30분 헤맴.
//       그 외로운 박힘 → 단일 자리로 통합 (clavier-hq RAY_DALIO_QUEUE 2026-05-28).
setDefaultResultOrder("ipv4first")

;(function ensureFresh() {
    if (process.env._CLAVIER_FRESHNESS_OK === "1") return
    if (process.env.CLAVIER_LOCAL_DEV === "1") {
        process.env._CLAVIER_FRESHNESS_OK = "1"
        return
    }
    if (process.env.GIT_DIR || process.env._CLAVIER_IN_HOOK === "1") return

    const scriptsRepo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
    const platformWorkersRepo = findPlatformWorkers()

    const tracked = [{ repo: scriptsRepo, label: "scripts" }]
    if (platformWorkersRepo) {
        tracked.push({ repo: platformWorkersRepo, label: "platform-workers" })
    }

    for (const { repo, label } of tracked) {
        checkRepo(repo, label)
    }

    process.env._CLAVIER_FRESHNESS_OK = "1"
})()

function checkRepo(repo, label) {
    let branch
    try {
        branch = execSync(`git -C "${repo}" symbolic-ref --short HEAD`, {
            encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        }).trim()
    } catch {
        return  // detached HEAD or non-git — skip
    }

    let fetched = true
    try {
        execSync(`git -C "${repo}" fetch --quiet origin main`, {
            stdio: ["ignore", "ignore", "ignore"], timeout: 8000,
        })
    } catch {
        fetched = false
    }

    if (branch === "main") {
        if (!fetched) {
            process.stderr.write(`\x1b[33m! freshness[${label}]: git fetch 실패 (오프라인?) — 로컬 main 으로 진행\x1b[0m\n`)
            return
        }

        let ahead, behind
        try {
            const out = execSync(
                `git -C "${repo}" rev-list --left-right --count main...origin/main`,
                { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
            ).trim()
            ;[ahead, behind] = out.split(/\s+/).map(Number)
        } catch {
            return
        }

        if (ahead === 0 && behind === 0) return

        if (ahead > 0) {
            // fail-open: freshness 는 인프라 경고일 뿐 — 절대 차단하지 않는다 (DECISIONS 2026-05-30).
            process.stderr.write(
                `\n\x1b[33m! freshness[${label}]: 로컬 main 이 origin 보다 ${ahead} commit 앞섭니다 (경고만, 차단 안 함).\x1b[0m\n` +
                `\x1b[33m    비정상일 수 있음. 조사:  git -C "${repo}" log origin/main..main\x1b[0m\n\n`,
            )
            return
        }

        // behind > 0, ahead === 0 → ff-only 시도 (실패해도 경고만, 차단 안 함)
        try {
            execSync(`git -C "${repo}" pull --ff-only --quiet origin main`, {
                stdio: ["ignore", "ignore", "pipe"], timeout: 8000,
            })
            process.stderr.write(`\x1b[36mℹ freshness[${label}]: origin/main 에서 ${behind} 새 commit 적용\x1b[0m\n`)
        } catch {
            // fail-open: 작업 트리가 더러워 자동 pull 못 해도 차단하지 않는다 (DECISIONS 2026-05-30).
            process.stderr.write(
                `\n\x1b[33m! freshness[${label}]: origin 보다 ${behind} commit 뒤처짐 — 작업 트리가 더러워 자동 pull 못 함 (경고만, 차단 안 함).\x1b[0m\n` +
                `\x1b[33m    정리되면 직접:  git -C "${repo}" pull --ff-only\x1b[0m\n\n`,
            )
        }
        return
    }

    // branch != main — feature branch.
    // CLAVIER_TEST_BRANCH=1 이면 테스트 목적으로 명시한 것 → 경고만 하고 통과.
    // 그 외 scripts repo 는 자동으로 main 전환 후 재실행 — feature branch 로 실수 실행 경로 차단.
    if (process.env.CLAVIER_TEST_BRANCH === "1") {
        process.stderr.write(`\x1b[33m⚑  test-branch[${label}]: '${branch}' 기준으로 실행 (CLAVIER_TEST_BRANCH=1)\x1b[0m\n`)
        return
    }

    if (label !== "scripts") {
        // platform-workers 등 — 경고만 (재실행 주체가 아님)
        if (!fetched) return
        try {
            const behind = Number(execSync(
                `git -C "${repo}" rev-list --count HEAD..origin/main`,
                { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
            ).trim())
            if (behind > 0) {
                process.stderr.write(
                    `\n\x1b[33m! freshness[${label}]: '${branch}' 가 origin/main 보다 ${behind} commit 부족.\x1b[0m\n` +
                    `\x1b[33m    테스트 목적이면 유지. 아니면:  git -C "${repo}" checkout main\x1b[0m\n\n`,
                )
            }
        } catch { /* best-effort */ }
        return
    }

    // scripts repo, non-main — fail-open: 브랜치를 강제 전환하지 않는다.
    // 예전엔 자동 `git checkout main` 후 재실행했으나, 작업 중인 브랜치를 사용자
    // 몰래 바꾸는 파괴적 부작용이라 폐기 (DECISIONS 2026-05-30). 이제 경고만 —
    // platform-workers 와 동일하게 advisory.
    if (!fetched) return
    try {
        const behind = Number(execSync(
            `git -C "${repo}" rev-list --count HEAD..origin/main`,
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim())
        if (behind > 0) {
            process.stderr.write(
                `\n\x1b[33m! freshness[${label}]: '${branch}' 가 origin/main 보다 ${behind} commit 부족 (경고만, 전환·차단 안 함).\x1b[0m\n` +
                `\x1b[33m    의도적이면 무시. main 코드로 실행하려면:  git -C "${repo}" checkout main\x1b[0m\n\n`,
            )
        }
    } catch { /* best-effort */ }
    return
}
