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
 *   - branch != main:
 *       fetch origin main
 *       origin/main 이 HEAD 보다 앞서 있으면 → 노란 경고 (블록 X, 작업 흐름 보존)
 *       "프로덕션 픽스가 누락됐을 가능성 — merge origin/main 권장" 알림
 *       offline 이면 침묵 통과
 *
 * 한 프로세스에 한 번만 수행 (env guard). 자식 프로세스에도 전파됨.
 * `CLAVIER_LOCAL_DEV=1` 으로 dev-escape 가능 (의도적 stale 실행).
 * git hook 내부 (GIT_DIR set) 에서는 skip — 재귀 방지.
 */

import { execSync } from "child_process"
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"
import { findPlatformWorkers } from "./repoPaths.mjs"

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
            process.stderr.write(
                `\n\x1b[31m‼️  freshness[${label}]: 로컬 main 이 origin 보다 ${ahead} commit 앞섭니다.\x1b[0m\n` +
                `\x1b[31m    main 직접 커밋은 pre-commit hook 으로 차단되니 이 상태는 정상이 아닙니다.\x1b[0m\n` +
                `\x1b[31m    조사:  git -C "${repo}" log origin/main..main\x1b[0m\n\n`,
            )
            process.exit(2)
        }

        // behind > 0, ahead === 0 → ff-only 안전
        try {
            execSync(`git -C "${repo}" pull --ff-only --quiet origin main`, {
                stdio: ["ignore", "ignore", "pipe"], timeout: 8000,
            })
            process.stderr.write(`\x1b[36mℹ freshness[${label}]: origin/main 에서 ${behind} 새 commit 적용\x1b[0m\n`)
        } catch {
            process.stderr.write(
                `\n\x1b[31m‼️  freshness[${label}]: ff-only pull 실패 — 로컬 main 에 uncommitted/untracked 변경?\x1b[0m\n` +
                `\x1b[31m    조사:  git -C "${repo}" status\x1b[0m\n\n`,
            )
            process.exit(2)
        }
        return
    }

    // branch != main — feature branch.
    // origin/main 에 현재 브랜치가 아직 안 받은 commit 있으면 경고만 (블록 X).
    // 프로덕션 픽스가 main 에 들어갔는데 feature 브랜치 로컬 코드로 실행하다 빠뜨리는 함정 차단.
    if (!fetched) return  // 오프라인 — 침묵 통과

    try {
        const behindMain = Number(execSync(
            `git -C "${repo}" rev-list --count HEAD..origin/main`,
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim())
        if (behindMain > 0) {
            process.stderr.write(
                `\n\x1b[33m! freshness[${label}]: '${branch}' 가 origin/main 보다 ${behindMain} commit 부족.\x1b[0m\n` +
                `\x1b[33m    프로덕션 픽스가 누락됐을 가능성. 권장:  git -C "${repo}" merge origin/main\x1b[0m\n` +
                `\x1b[33m    누락 commit 확인:  git -C "${repo}" log HEAD..origin/main --oneline\x1b[0m\n\n`,
            )
        }
    } catch {
        /* 무시 — 경고는 best-effort */
    }
}
