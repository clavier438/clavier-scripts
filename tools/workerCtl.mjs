#!/usr/bin/env node
/**
 * workerCtl — Cloudflare Worker 제어 CLI
 *
 * 사용법:
 *   workerCtl                        # 전체 브리핑 → 대화형 (워커 선택 → 함수 선택)
 *   workerCtl --help                 # 상세 도움말
 *   workerCtl <워커이름>              # 워커 지정 후 함수 선택
 *   workerCtl <워커이름> <함수id>     # 바로 실행
 */

import { createInterface } from "readline"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { execSync, spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { homedir } from "os"
import { findPlatformWorkers, findClavierHq } from "./lib/repoPaths.mjs"
import { DOPPLER_PROJECT, getWorkerEnv, listWorkerEnvs } from "./lib/workerEnvMap.mjs"

// framer-sync 코드 본체 경로 (wrangler 명령 실행 기준 디렉토리)
// sibling-first 자동 탐색 (environment-peer 모델, DECISIONS 2026-05-03)
const FRAMER_SYNC_DIR = process.env.FRAMER_SYNC_DIR
    ?? (findPlatformWorkers() ? join(findPlatformWorkers(), "framer-sync") : null)

if (!FRAMER_SYNC_DIR || !existsSync(FRAMER_SYNC_DIR)) {
    console.error(`framer-sync 경로 못 찾음. FRAMER_SYNC_DIR env 설정 또는 platform-workers repo 클론 필요.`)
    process.exit(1)
}

// 워커 URL 패턴 — Cloudflare account subdomain
const WORKER_SUBDOMAIN = process.env.WORKER_SUBDOMAIN ?? "hyuk439.workers.dev"

// wrangler shell 실행 — Doppler로 cfat 토큰 주입 (DECISIONS 2026-04-30).
// config 인자 생략 시 prd (sisoso) 기본 — register 등 신규 워커 부트스트랩이 이걸 쓴다.
function shellWrangler(cmd, config = "prd") {
    return execSync(`doppler run --project ${DOPPLER_PROJECT} --config ${config} -- ${cmd}`, {
        cwd: FRAMER_SYNC_DIR,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
    })
}

// === 시크릿 단일 진실 소스 = Doppler (CLAUDE.md 2026-04-28~) ===
// doppler 사용 가능하면 self-relaunch 로 정확한 env 주입.
// 실패 시(오프라인·login 안 됨) ~/.clavier/env 폴백.
if (!process.env.WORKERCTL_DOPPLER_INJECTED) {
    let dopplerOk = false
    try { execSync("doppler --version", { stdio: "ignore", timeout: 2000 }); dopplerOk = true }
    catch { /* doppler 없음 → 폴백 */ }
    if (dopplerOk) {
        const r = spawnSync("doppler",
            ["run", "--project", "clavier", "--config", "prd", "--", process.execPath, ...process.argv.slice(1)],
            { stdio: "inherit", env: { ...process.env, WORKERCTL_DOPPLER_INJECTED: "1" } })
        if (!r.error) process.exit(r.status ?? 0)
    }
}

// ~/.clavier/env 폴백 — Doppler 미사용 시
try {
    const envFile = join(homedir(), ".clavier", "env")
    readFileSync(envFile, "utf8").split("\n").forEach(line => {
        line = line.trim()
        if (!line || line.startsWith("#") || !line.includes("=")) return
        const [k, ...rest] = line.split("=")
        const key = k.trim()
        let val = rest.join("=").trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
        }
        if (!process.env[key]) process.env[key] = val
    })
} catch { /* ~/.clavier/env 없으면 shell env 사용 */ }

const __dir = dirname(fileURLToPath(import.meta.url))

// SSOT 변경 (DECISIONS 2026-05-05): tools/workers.json 폐기 → Cloudflare API live.
// 워커 목록은 매번 Cloudflare 에서 조회 (~/.cache/clavier/workers.json 60s TTL).
// 이유: workers.json 수동 갱신은 *deploy 와 separated* 되어 drift 발생.
//       (예: framer-sync-mukayu deploy 했는데 workers.json 등록 잊어 workerCtl 못 봄.)
// 따라서 *deploy 자체가 곧 등록*. URL 도 name 에서 derive — 사람 손으로 박을 게 없음.
const WORKER_PREFIX = "framer-sync-"
const WORKERS_CACHE_DIR = join(homedir(), ".cache", "clavier")
const WORKERS_CACHE_FILE = join(WORKERS_CACHE_DIR, "workers.json")
const WORKERS_CACHE_TTL_MS = 60_000

// ── 색상 유틸 ──────────────────────────────────────────────────────────────
const c = {
    reset:  "\x1b[0m",
    bold:   "\x1b[1m",
    dim:    "\x1b[2m",
    cyan:   "\x1b[36m",
    green:  "\x1b[32m",
    yellow: "\x1b[33m",
    red:    "\x1b[31m",
    gray:   "\x1b[90m",
}
const bold   = s => `${c.bold}${s}${c.reset}`
const dim    = s => `${c.dim}${s}${c.reset}`
const cyan   = s => `${c.cyan}${s}${c.reset}`
const green  = s => `${c.green}${s}${c.reset}`
const yellow = s => `${c.yellow}${s}${c.reset}`
const red    = s => `${c.red}${s}${c.reset}`
const gray   = s => `${c.gray}${s}${c.reset}`

// ── Framer 프로젝트 ↔ 토큰 매핑 (Doppler FRAMER_PROJECTS JSON) ─────────────
// 한 Framer 프로젝트는 (projectUrl, apiToken) 쌍을 항상 함께 가진다.
// Doppler 단일 키 FRAMER_PROJECTS 에 객체로 저장: { <projectId>: { url, token } }
const FRAMER_PROJECTS_KEY = "FRAMER_PROJECTS"

function getDopplerSecret(key, config = "prd") {
    const r = spawnSync("doppler",
        ["secrets", "get", key, "--project", DOPPLER_PROJECT, "--config", config,
         "--plain", "--no-exit-on-missing-secret"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    if (r.status !== 0) return null
    const out = (r.stdout ?? "").toString().trim()
    return out || null
}

function setDopplerSecret(key, value, config = "prd") {
    const r = spawnSync("doppler",
        ["secrets", "set", key, "--project", DOPPLER_PROJECT, "--config", config, "--silent"],
        { input: value, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    if (r.status !== 0) {
        throw new Error(`Doppler 저장 실패 (${config}): ${(r.stderr ?? "").toString().trim() || "unknown"}`)
    }
}

function extractFramerProjectId(url) {
    const m = String(url).match(/projects\/[^?#]*--([A-Za-z0-9]{20})/)
    return m ? m[1] : null
}

function loadFramerProjects(config = "prd") {
    const raw = getDopplerSecret(FRAMER_PROJECTS_KEY, config)
    if (!raw) return {}
    try {
        const obj = JSON.parse(raw)
        return obj && typeof obj === "object" ? obj : {}
    } catch { return {} }
}

function saveFramerProjects(projects, config = "prd", workerName = null) {
    setDopplerSecret(FRAMER_PROJECTS_KEY, JSON.stringify(projects), config)
    // Doppler 갱신 후 자동으로 wrangler secrets 도 동기화 — desync 방지 (Doppler-only SSOT 정신)
    // workerName 주면 그 워커만, null 이면 전체 sync
    syncDopplerToWrangler(workerName)
}

// Doppler → wrangler secrets 동기화 (별도 스크립트 호출). 실패해도 throw 안 함.
// workerName 주면 그 워커만 (예: "mukayu"), null 이면 모든 워커 일괄 sync.
function syncDopplerToWrangler(workerName = null) {
    const args = workerName ? [workerName] : []
    try {
        const r = spawnSync("doppler-sync-wrangler", args,
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 })
        if (r.status === 0) {
            const target = workerName ?? "전체"
            console.log(dim(`  ↳ doppler-sync-wrangler: ${target} secrets 자동 갱신 완료`))
        } else {
            const hint = workerName ? `doppler-sync-wrangler ${workerName}` : "doppler-sync-wrangler"
            console.log(yellow(`  ⚠️  wrangler 자동 sync 실패 — 수동 '${hint}' 필요`))
        }
    } catch (e) {
        console.log(yellow(`  ⚠️  wrangler 자동 sync 스킵: ${e.message}`))
    }
}

// ── readline 유틸 ──────────────────────────────────────────────────────────
function prompt(rl, question) {
    return new Promise(resolve => rl.question(question, resolve))
}

async function selectFromList(rl, items, labelFn) {
    items.forEach((item, i) => {
        console.log(`  ${bold(String(i + 1).padStart(2))}. ${labelFn(item)}`)
    })
    console.log()

    while (true) {
        const input = (await prompt(rl, `선택 (1-${items.length}): `)).trim()
        const n = parseInt(input, 10)
        if (n >= 1 && n <= items.length) return items[n - 1]
        console.log(red(`  ✗ 1~${items.length} 중에서 입력해주세요`))
    }
}

// ── 워커 레지스트리 로드 ───────────────────────────────────────────────────
// streamingStep loop — done=true 까지 step 호출 + 진행 표시 (time-budget streaming)
async function loopStreamingSteps(workerUrl, stepPath) {
    console.log()
    console.log(dim("  step 진행 — workerCtl 가 done 까지 자동 호출 (cron 매분 백업도 동작 중):"))
    console.log()

    const seen = new Map() // collection → 누적 진행
    let stepNum = 0
    const maxSteps = 50  // 안전 한도 (records 100,000+ 까지)

    // 초기 stage1 끝나길 약간 대기 (init 백그라운드)
    await new Promise(r => setTimeout(r, 3000))

    while (stepNum < maxSteps) {
        stepNum++
        let res, data
        try {
            res = await fetch(`${workerUrl}${stepPath}`, { method: "POST", signal: AbortSignal.timeout(40_000) })
            data = await res.json()
        } catch (e) {
            console.log(yellow(`    [step ${stepNum}] 연결 오류 — 재시도 (${e.message})`))
            await new Promise(r => setTimeout(r, 3000))
            continue
        }
        if (!res.ok) {
            console.log(red(`    [step ${stepNum}] HTTP ${res.status}`))
            return false
        }

        const elapsed = ((data.elapsedMs ?? 0) / 1000).toFixed(1)
        const processed = data.processed ?? []

        for (const p of processed) {
            const prev = seen.get(p.collection) ?? 0
            const cur = prev + p.pushed
            seen.set(p.collection, cur)
            const tag = p.done ? green("✓") : yellow("…")
            const tail = p.done ? dim(`(${cur}/${p.total})`) : dim(`(${cur}/${p.total} 남음)`)
            console.log(`    ${tag}  ${p.collection.padEnd(12)} ${tail}`)
        }
        if (data.phase === "stage1") {
            console.log(dim(`    [step ${stepNum}] stage1 진행 중 (Airtable → D1) — 대기`))
            await new Promise(r => setTimeout(r, 3000))
            continue
        }
        if (processed.length === 0 && data.remaining > 0) {
            // workerCtl 의 step polling 이 워커 stage2 보다 빨라 false negative 가능.
            // 워커 /managed-status 직접 확인 — 진짜 done 까지 cron 백업 매분 도므로 90초 대기.
            // (ADR 2026-05-12 "time-budget streaming = cross-cutting wrapper")
            console.log(yellow(`    [step ${stepNum}] workerCtl step 진행 0 (queueRemaining=${data.remaining}) — 워커 status 직접 확인 중...`))

            const pollIntervalMs = 30_000  // 30초
            const maxPollMs = 90_000       // 90초 = cron 1-2번
            let waited = 0
            while (waited < maxPollMs) {
                await new Promise(r => setTimeout(r, pollIntervalMs))
                waited += pollIntervalMs
                let statusRes, status
                try {
                    statusRes = await fetch(`${workerUrl}/managed-status`, { signal: AbortSignal.timeout(10_000) })
                    status = await statusRes.json()
                } catch (e) {
                    console.log(dim(`               · status 호출 실패 (${e.message}) — 재시도`))
                    continue
                }
                if (status.status === "done") {
                    console.log()
                    console.log(green(`  ✅ 큐 완료 (cron 백업이 마무리, 총 records 정보는 워커 /managed-status 참조)`))
                    console.log()
                    return true
                }
                if (status.status === "error") {
                    console.log(red(`  ❌ 워커 에러: ${status.error ?? 'unknown'}`))
                    return false
                }
                console.log(dim(`               · 워커 진행 중 (queueRemaining=${status.queueRemaining ?? '?'}, ${waited/1000}s 대기)`))
            }

            // 90초 후에도 done 아님 — 진행 중일 수 있으나 사용자 입력 받음.
            console.log(yellow(`    [step ${stepNum}] 90초 후에도 done 아님 — 워커는 계속 진행 중일 수 있음`))
            console.log(dim(`               · cron 매분 백업이 이어받아 완료시킴 (Mac 닫혀도 OK)`))
            console.log(dim(`               · 수동 확인: curl ${workerUrl}/managed-status`))
            return false
        }

        if (data.done) {
            console.log()
            console.log(green(`  ✅ 큐 완료 (${stepNum} step, 총 ${[...seen.values()].reduce((a,b)=>a+b,0)} records)`))
            console.log()
            return true
        }
    }

    console.log(yellow(`  ⚠️ ${maxSteps} step 도달 — 안전 한도. cron 백업이 마저 처리할 것.`))
    return true
}

// 응답 출력 — transformChain 같은 멀티라인 string 필드는 raw 로 분리 표시 (JSON escape 회피)
function printResponseBody(body) {
    if (body && typeof body === "object") {
        if (typeof body.transformChain === "string") {
            console.log(body.transformChain)
            const { transformChain, ...rest } = body
            body = rest
        }
    }
    console.log(JSON.stringify(body, null, 2).split("\n").map(l => `  ${l}`).join("\n"))
}

// 2026-05-05: workers.json 폐기 → Cloudflare API live (SSOT). 60s TTL cache.
// drift 자체가 구조적으로 불가능 — deploy === 등록.
async function loadWorkers({ noCache = false } = {}) {
    if (!noCache) {
        try {
            const raw = readFileSync(WORKERS_CACHE_FILE, "utf8")
            const cached = JSON.parse(raw)
            if (Date.now() - cached.fetchedAt < WORKERS_CACHE_TTL_MS) {
                return cached.workers
            }
        } catch { /* miss */ }
    }
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const token = process.env.CLOUDFLARE_API_TOKEN
    if (!accountId || !token) {
        console.error(red("✗ CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN env 없음"))
        console.error(dim("  doppler run --project clavier --config prd -- workerCtl …"))
        process.exit(1)
    }
    let scripts
    try {
        const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        scripts = data.result ?? []
    } catch (e) {
        console.error(red(`✗ Cloudflare API 조회 실패: ${e.message}`))
        process.exit(1)
    }
    const workers = scripts
        .filter(s => s.id.startsWith(WORKER_PREFIX))
        .map(s => {
            const name = s.id.slice(WORKER_PREFIX.length)
            return {
                name,
                label: `${name} (Framer ↔ Airtable)`,
                url: `https://${s.id}.${WORKER_SUBDOMAIN}`,
            }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    try {
        if (!existsSync(WORKERS_CACHE_DIR)) mkdirSync(WORKERS_CACHE_DIR, { recursive: true })
        writeFileSync(WORKERS_CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), workers }, null, 2))
    } catch { /* cache write best-effort */ }
    return workers
}

function bustWorkersCache() {
    try { writeFileSync(WORKERS_CACHE_FILE, JSON.stringify({ fetchedAt: 0, workers: [] })) } catch {}
}

// ── /capabilities 호출 ────────────────────────────────────────────────────
async function fetchCapabilities(workerUrl) {
    const res = await fetch(`${workerUrl}/capabilities`, {
        signal: AbortSignal.timeout(10_000),
    }).catch(err => { throw new Error(`연결 실패: ${err.message}`) })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data?.functions)) throw new Error("capabilities 형식 불일치")
    return data
}

// ── params 입력 수집 ───────────────────────────────────────────────────────
async function collectParams(rl, params, current = {}) {
    const body = {}
    console.log()
    console.log(bold("  설정 값을 입력하세요:"))
    const hasExistingConfig = Object.keys(current).length > 0
    console.log(dim(hasExistingConfig
        ? "  (Enter: 현재 값 유지  ·  새 값 입력 시 교체)"
        : "  (선택 항목은 Enter로 건너뛸 수 있습니다 / env 값은 자동 적용)"))
    console.log()

    for (const p of params) {
        const envVal = p.envKey ? process.env[p.envKey] : null
        if (envVal) {
            const preview = p.secret ? dim("***") : gray(envVal.slice(0, 20) + (envVal.length > 20 ? "…" : ""))
            console.log(`  ${bold(p.label)}: ${green("✓")} ${dim(`$${p.envKey}`)} ${preview}`)
            body[p.key] = envVal
            continue
        }

        const currentVal = p.statusKey !== undefined ? current[p.statusKey] : undefined
        const hasExisting = currentVal === true || (typeof currentVal === "string" && currentVal.length > 0)
        const isRequired = p.required && !hasExisting

        let hintDisplay = ""
        if (hasExisting) {
            hintDisplay = p.secret
                ? dim("  설정됨 — Enter로 유지")
                : `  ${gray(String(currentVal).slice(0, 40) + (String(currentVal).length > 40 ? "…" : ""))}${dim(" — Enter로 유지")}`
        } else if (p.hint) {
            hintDisplay = `  ${gray(`(${p.hint})`)}`
        }

        const tag   = isRequired ? red("*필수") : dim("선택")
        const label = `  ${bold(p.label)}${hintDisplay} [${tag}]: `

        while (true) {
            const val = (await prompt(rl, label)).trim()
            if (val) { body[p.key] = val; break }
            if (hasExisting) break
            if (!p.required) break
            console.log(red(`  ✗ 필수 항목입니다`))
        }
    }
    console.log()
    return body
}

// ── 비동기 작업 status polling ────────────────────────────────────────────
// statusPath="/status" → 구 방식 (sync.lastSync 비교)
// statusPath 그 외    → 범용 방식 (status === "done" | "error" 감지)
async function pollUntilComplete(workerUrl, triggerTimeMs, statusPath = "/status", maxWaitMs = 15 * 60 * 1000) {
    const start = Date.now()
    let dotCount = 0
    while (Date.now() - start < maxWaitMs) {
        await new Promise(r => setTimeout(r, 3000))

        const elapsed = ((Date.now() - start) / 1000).toFixed(0)
        const dots = ".".repeat((dotCount++ % 3) + 1).padEnd(3)
        process.stdout.write(`\r  ${gray(`백그라운드 작업 진행 중${dots} (${elapsed}s 경과)`)}     `)

        try {
            const res = await fetch(`${workerUrl}${statusPath}`, { signal: AbortSignal.timeout(5000) })
            if (!res.ok) continue
            const data = await res.json()

            if (statusPath !== "/status") {
                // 범용: status 필드가 "done" 또는 "error" 이면 완료
                const s = data?.status
                if (s === "done" || s === "error") {
                    process.stdout.write("\r" + " ".repeat(60) + "\r")
                    return data
                }
                continue
            }

            // 구 방식: /status의 sync.lastSync가 트리거 이후면 완료
            const lastSyncRaw = data?.sync?.lastSync
            if (!lastSyncRaw) {
                process.stdout.write("\r" + " ".repeat(60) + "\r")
                return null
            }
            const lastSyncTime = new Date(lastSyncRaw).getTime()
            if (lastSyncTime > triggerTimeMs) {
                process.stdout.write("\r" + " ".repeat(60) + "\r")
                return data.sync
            }
        } catch { /* 일시적 오류 → 다음 시도 */ }
    }
    process.stdout.write("\r" + " ".repeat(60) + "\r")
    return null
}

// ── 일반 함수 실행 ────────────────────────────────────────────────────────
async function runFunction(workerUrl, fn, body = null) {
    const url = `${workerUrl}${fn.path}`
    const method = fn.method ?? "POST"

    console.log()
    console.log(gray(`  ${method} ${url}`))
    console.log()

    const triggerTime = Date.now()
    const start = Date.now()
    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(120_000), // 2분 — 90s Framer connect 버퍼 포함
    }).catch(err => { throw new Error(`요청 실패: ${err.message}`) })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    let responseBody
    try { responseBody = await res.json() }
    catch { responseBody = await res.text() }

    if (res.ok) {
        console.log(green(`  ✅ 요청 수락 (${elapsed}s)`))
    } else {
        console.log(red(`  ✗ 오류 (HTTP ${res.status}, ${elapsed}s)`))
    }

    console.log()
    printResponseBody(responseBody)
    console.log()

    // streamingStep 감지: capabilities 의 streamingStep 경로가 있으면 done=true 까지 자동 loop
    if (res.ok && fn.streamingStep) {
        await loopStreamingSteps(workerUrl, fn.streamingStep)
        return true
    }

    // 비동기 작업 감지: 응답 메시지에 "시작됨"/"started" → status polling
    if (res.ok && typeof responseBody === "object" && responseBody !== null) {
        const noteText = String(responseBody.note ?? responseBody.message ?? "")
        const isAsync = /시작됨|started|시작/i.test(noteText)
        if (isAsync) {
            const statusPath = fn.asyncStatusPath ?? "/status"
            const finalStatus = await pollUntilComplete(workerUrl, triggerTime, statusPath)
            if (finalStatus) {
                const totalElapsed = ((Date.now() - triggerTime) / 1000).toFixed(0)
                const ok = statusPath === "/status" ? finalStatus.status === "ok" : finalStatus.status === "done"
                console.log(ok
                    ? green(`  ✅ 백그라운드 작업 완료 (총 ${totalElapsed}s)`)
                    : red(`  ✗ 백그라운드 작업 실패 (총 ${totalElapsed}s)`))
                console.log()
                printResponseBody(finalStatus)
                console.log()
                return ok
            } else {
                const workerShort = workerUrl.split("//")[1].split(".")[0]
                console.log(yellow(`  ⚠️ 백그라운드 작업 상태 확인 불가 (timeout 또는 미지원)`))
                console.log(dim(`     수동 확인: workerCtl ${workerShort} managed-status`))
                console.log()
            }
        }
    }

    return res.ok
}

// ── 도움말 ────────────────────────────────────────────────────────────────
function showHelp(workers) {
    const hr = gray("  " + "─".repeat(54))

    console.log()
    console.log(bold(cyan("  🔧 workerCtl — Cloudflare Worker 제어 CLI")))
    console.log()
    console.log(hr)
    console.log()

    console.log(bold("  사용법"))
    console.log()
    console.log(`    ${cyan("workerCtl")}                          ${dim("전체 브리핑 후 대화형 실행")}`)
    console.log(`    ${cyan("workerCtl --help")}                   ${dim("이 도움말")}`)
    console.log(`    ${cyan("workerCtl panel")}                    ${dim("모든 워커 상태 표 출력 + 스냅샷 저장")}`)
    console.log(`    ${cyan("workerCtl conduct")}                  ${dim("panel + WORKER_STATUS.md 자동 갱신")}`)
    console.log(`    ${cyan("workerCtl backup")}                   ${dim("모든 워커 상태 → Airtable system_snapshots 저장")}`)
    console.log(`    ${cyan("workerCtl register [이름]")}           ${dim("새 프로젝트 전체 프로비저닝 (KV·D1·배포·configure 자동)")}`)
    console.log(`    ${cyan("workerCtl <워커>")}                   ${dim("워커 지정 → 함수 선택")}`)
    console.log(`    ${cyan("workerCtl <워커> <함수>")}            ${dim("바로 실행")}`)
    console.log()
    console.log(hr)
    console.log()

    console.log(bold("  등록된 워커  ") + dim(`(Cloudflare API live, prefix=${WORKER_PREFIX})`))
    console.log()
    workers.forEach(w => {
        console.log(`    ${bold(cyan(w.name.padEnd(16)))} ${w.label ?? ""}`)
        console.log(`    ${dim(" ".repeat(16))} ${gray(w.url)}`)
        console.log()
    })
    console.log(hr)
    console.log()

    console.log(bold("  3-레이어 파이프라인 (framer-sync 기준)"))
    console.log()
    console.log(`  ┌─ Layer 1: Airtable → D1 stage1_cache         ${dim("(Framer 호출 없음)")}`)
    console.log(`  ├─ Layer 2: D1 → ManagedCollection (push-managed)  ${dim("(Framer 공식 API)")}`)
    console.log(`  └─ Layer 3: ManagedCollection → Native         ${dim("(Framer 편집기 UI, 수동)")}`)
    console.log()

    const exampleFns = [
        ["push-managed",      "POST",  "Layer 1+2: Airtable → D1 → ManagedCollection",     ""],
        ["managed-status",    "GET ",  "push-managed 진행 상태 확인",                        ""],
        ["sync-stage1",       "POST",  "Layer 1만 — Airtable → D1",                         ""],
        ["delete-managed",    "POST",  "ManagedCollection 삭제 (?filter= 패턴)",             ""],
        ["duplicate-managed", "POST",  "ManagedCollection cloneNode로 Native 복제",         ""],
        ["convert-images",    "POST",  "Airtable 첨부 → WebP 일괄 변환",                     ""],
        ["status",            "GET ",  "상태, 설정값, 마지막 실행 결과 확인",                  ""],
        ["configure",         "POST",  "연결 설정 변경 (Airtable ID, Framer 토큰 등)",         ""],
    ]
    console.log(`  ${bold("ID".padEnd(20))} ${"METHOD".padEnd(6)} 설명`)
    console.log(`  ${dim("─".repeat(70))}`)
    exampleFns.forEach(([id, method, desc, constraint]) => {
        const note = constraint ? `  ${yellow(constraint)}` : ""
        console.log(`  ${cyan(id.padEnd(20))} ${gray(method.padEnd(6))} ${desc}${note}`)
    })
    console.log()
    console.log(hr)
    console.log()

    console.log(bold("  예시"))
    console.log()
    console.log(`    ${dim("workerCtl")}                          ${dim("→ 전체 브리핑 + 대화형")}`)
    console.log(`    ${dim("workerCtl sisoso")}                   ${dim("→ sisoso 함수 선택")}`)
    console.log(`    ${dim("workerCtl sisoso status")}            ${dim("→ 상태 즉시 확인")}`)
    console.log(`    ${dim("workerCtl sisoso push-managed")}      ${dim("→ Layer 1+2 ManagedCollection 전체 푸시")}`)
    console.log(`    ${dim("workerCtl sisoso managed-status")}    ${dim("→ push-managed 진행 상태 확인")}`)
    console.log(`    ${dim("workerCtl sisoso sync-stage1")}       ${dim("→ Layer 1만 실행 (Airtable → D1)")}`)
    console.log(`    ${dim("workerCtl sisoso configure")}         ${dim("→ Airtable/Framer 연결 설정 변경")}`)
    console.log(`    ${dim("workerCtl register")}                ${dim("→ 새 프로젝트 대화형 프로비저닝")}`)
    console.log(`    ${dim("workerCtl register myproject")}      ${dim("→ 이름 지정해서 바로 시작")}`)
    console.log()
    console.log(hr)
    console.log()
}

// ── 스냅샷 디렉토리 ──────────────────────────────────────────────────────
const SNAPSHOT_DIR = join(__dir, "worker-snapshots")

async function fetchStatus(workerUrl) {
    const res = await fetch(`${workerUrl}/status`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

function saveSnapshot(workerName, status) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true })
    const file = join(SNAPSHOT_DIR, `${workerName}.json`)
    const snapshot = { ...status, snapshotAt: new Date().toISOString() }
    writeFileSync(file, JSON.stringify(snapshot, null, 2))
    return file
}

function timeAgo(iso) {
    if (!iso) return "—"
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return "방금"
    if (m < 60) return `${m}분 전`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}시간 전`
    return `${Math.floor(h / 24)}일 전`
}

function truncate(s, n) {
    if (!s) return "—"
    return s.length > n ? s.slice(0, n - 1) + "…" : s
}

// ── panel ─────────────────────────────────────────────────────────────────
async function runPanel(workers) {
    console.log(bold("  📋 Worker Panel"))
    console.log()

    const results = await Promise.allSettled(
        workers.map(async w => ({
            worker: w,
            status: await fetchStatus(w.url),
        }))
    )

    const cols = ["WORKER", "VER", "AIRTABLE", "FRAMER", "GTM", "LAST SYNC"]
    const widths = [16, 7, 18, 36, 14, 12]
    console.log(`  ${cols.map((n, i) => bold(n.padEnd(widths[i]))).join("  ")}`)
    console.log(gray("  " + "─".repeat(widths.reduce((a, b) => a + b + 2, 0))))

    let savedCount = 0
    results.forEach((r, i) => {
        const w = workers[i]
        if (r.status === "fulfilled") {
            const s = r.value.status
            saveSnapshot(w.name, s)
            savedCount++
            const framer = s.framerProjectUrl?.replace("https://framer.com/projects/", "f/") ?? null
            const cells = [
                truncate(w.name, widths[0]).padEnd(widths[0]),
                truncate(s.version ?? null, widths[1]).padEnd(widths[1]),
                truncate(s.airtableBaseId, widths[2]).padEnd(widths[2]),
                truncate(framer, widths[3]).padEnd(widths[3]),
                truncate(s.gtmContainerId, widths[4]).padEnd(widths[4]),
                timeAgo(s.sync?.lastSync).padEnd(widths[5]),
            ]
            console.log(`  ${cells.join("  ")}`)
        } else {
            console.log(`  ${red(w.name.padEnd(widths[0]))}  ${dim("연결 실패: " + (r.reason?.message ?? ""))}`)
        }
    })
    console.log()
    console.log(dim(`  📁 스냅샷 ${savedCount}개 저장: ${SNAPSHOT_DIR}/`))
    console.log()
}

// ── backup ────────────────────────────────────────────────────────────────
// 글로벌 백업 base/table — Doppler[prd] WORKERCTL_BACKUP_BASE / WORKERCTL_BACKUP_TABLE.
// Doppler self-relaunch (line 50) 가 prd 의 env 를 주입하므로 모든 워커 실행에서 동일.
const BACKUP_BASE  = process.env.WORKERCTL_BACKUP_BASE
const BACKUP_TABLE = process.env.WORKERCTL_BACKUP_TABLE

async function runBackup(workers) {
    const apiKey = process.env.AIRTABLE_API_KEY
    if (!apiKey) {
        console.error(red("  ✗ AIRTABLE_API_KEY 가 설정되지 않았습니다 (Doppler/~/.clavier/env 확인)"))
        process.exit(1)
    }
    if (!BACKUP_BASE || !BACKUP_TABLE) {
        console.error(red("  ✗ WORKERCTL_BACKUP_BASE / WORKERCTL_BACKUP_TABLE 이 Doppler[prd] 에 없습니다"))
        process.exit(1)
    }

    console.log(bold("  💾 Worker Backup → Airtable system_snapshots"))
    console.log()

    const results = await Promise.allSettled(
        workers.map(async w => ({
            worker: w,
            status: await fetchStatus(w.url),
        }))
    )

    const ts = new Date().toISOString()

    const cols = ["WORKER", "STATUS", "AIRTABLE_RECORD", "NOTE"]
    const widths = [16, 8, 30, 30]
    console.log(`  ${cols.map((n, i) => bold(n.padEnd(widths[i]))).join("  ")}`)
    console.log(gray("  " + "─".repeat(widths.reduce((a, b) => a + b + 2, 0))))

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const w = workers[i]

        if (r.status === "rejected") {
            failCount++
            console.log(`  ${red(w.name.padEnd(widths[0]))}  ${red("FAIL".padEnd(widths[1]))}  ${dim("—".padEnd(widths[2]))}  ${dim(truncate(r.reason?.message ?? "연결 실패", widths[3]))}`)
            continue
        }

        const s = r.value.status
        const recordId = `${w.name}-${ts}`
        const snapshotStr = JSON.stringify(s, null, 2)
        const snapshotTruncated = snapshotStr.length > 100_000 ? snapshotStr.slice(0, 100_000) : snapshotStr

        const fields = {
            id: recordId, worker: w.name, recordedAt: ts, trigger: "manual",
        }
        if (s.version           !== undefined) fields.version          = String(s.version)
        if (s.airtableBaseId    !== undefined) fields.airtableBaseId   = s.airtableBaseId
        if (s.framerProjectUrl  !== undefined) fields.framerProjectUrl = s.framerProjectUrl
        if (s.gtmContainerId    !== undefined) fields.gtmContainerId   = s.gtmContainerId
        fields.snapshotJson = snapshotTruncated

        try {
            const res = await fetch(`https://api.airtable.com/v0/${BACKUP_BASE}/${BACKUP_TABLE}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ fields }),
                signal: AbortSignal.timeout(15_000),
            })
            if (!res.ok) {
                const errBody = await res.text().catch(() => "")
                failCount++
                console.log(`  ${red(w.name.padEnd(widths[0]))}  ${red("FAIL".padEnd(widths[1]))}  ${dim("—".padEnd(widths[2]))}  ${dim(truncate(`HTTP ${res.status}: ${errBody}`, widths[3]))}`)
            } else {
                const created = await res.json()
                successCount++
                console.log(`  ${green(w.name.padEnd(widths[0]))}  ${green("OK".padEnd(widths[1]))}  ${cyan(truncate(created.id ?? recordId, widths[2]).padEnd(widths[2]))}  ${dim(truncate(s.version ? `v${s.version}` : "—", widths[3]))}`)
            }
        } catch (err) {
            failCount++
            console.log(`  ${red(w.name.padEnd(widths[0]))}  ${red("FAIL".padEnd(widths[1]))}  ${dim("—".padEnd(widths[2]))}  ${dim(truncate(err.message, widths[3]))}`)
        }
    }

    console.log()
    console.log(dim(`  ✅ 성공 ${successCount}개  /  ✗ 실패 ${failCount}개  (trigger=manual, ts=${ts})`))
    console.log()
}

// register: 새 프로젝트 전체 프로비저닝
// 사용자 결정: 이름, Airtable Base ID/Token, Framer URL/Key
// 자동: KV생성 → D1생성 → wrangler.toml 추가 → 마이그레이션 → 배포 → configure → sync
// (2026-05-05~: deploy === Cloudflare 등록. workers.json 단계 폐기.)
async function runRegister(args) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })

    console.log(bold("  🆕 새 프로젝트 프로비저닝"))
    console.log(dim("  사용자 결정 항목만 입력 — 나머지는 자동"))
    console.log()

    // ── 사용자 결정 항목 수집 ──────────────────────────────────────────────
    const name = (args[0] ?? (await prompt(rl, `  ${bold("프로젝트 이름")} ${dim("(예: myproject)")}: `)).trim()).trim()
    if (!name) { rl.close(); console.error(red("  ✗ 이름 필수")); process.exit(1) }

    const airtableBaseId = (await prompt(rl, `  ${bold("Airtable Base ID")} ${dim("(appXXX...)")}: `)).trim()
    if (!airtableBaseId) { rl.close(); console.error(red("  ✗ Base ID 필수")); process.exit(1) }

    const envAirtableToken = process.env.AIRTABLE_API_KEY ?? process.env.AIRTABLE_TOKEN ?? ""
    let airtableToken = envAirtableToken
    if (airtableToken) {
        console.log(`  ${bold("Airtable Token")}: ${green("✓")} ${dim("$AIRTABLE_API_KEY")} ${dim("***")}`)
    } else {
        airtableToken = (await prompt(rl, `  ${bold("Airtable API Token")} ${dim("(pat...)")}: `)).trim()
        if (!airtableToken) { rl.close(); console.error(red("  ✗ Token 필수")); process.exit(1) }
    }

    const framerProjectUrl = (await prompt(rl, `  ${bold("Framer Project URL")} ${dim("(https://framer.com/projects/...)")}: `)).trim()
    if (!framerProjectUrl) { rl.close(); console.error(red("  ✗ Framer URL 필수")); process.exit(1) }

    const envFramerToken = process.env.FRAMER_TOKEN ?? process.env.FRAMER_API_KEY ?? ""
    let framerApiKey = envFramerToken
    if (framerApiKey) {
        console.log(`  ${bold("Framer API Key")}: ${green("✓")} ${dim("$FRAMER_TOKEN")} ${dim("***")}`)
    } else {
        framerApiKey = (await prompt(rl, `  ${bold("Framer API Key")} ${dim("(fr_...)")}: `)).trim()
        if (!framerApiKey) { rl.close(); console.error(red("  ✗ Framer Key 필수")); process.exit(1) }
    }

    const gtmId = (await prompt(rl, `  ${bold("GTM Container ID")} ${dim("(선택 — Enter 건너뜀)")}: `)).trim()
    rl.close()

    // env key: sisoso, myProject (wrangler.toml [env.<key>])
    // wrangler은 camelCase env key를 권장하지만 소문자도 가능 — 이름 그대로 사용
    const envKey = name
    const workerName = `framer-sync-${name}`
    const workerUrl  = `https://${workerName}.${WORKER_SUBDOMAIN}`
    const d1Name     = `framer-sync-${name}`

    console.log()
    console.log(bold(`  🚀 프로비저닝 시작 — ${cyan(name)}`))
    console.log(gray(`     Cloudflare Worker: ${workerName}`))
    console.log(gray(`     URL: ${workerUrl}`))
    console.log()

    // ── Step 1: KV namespace 생성 ─────────────────────────────────────────
    process.stdout.write(`  ${bold("1/7")} KV namespace 생성...`)
    let kvId
    try {
        const out = shellWrangler(`npx wrangler kv namespace create "${name}"`)
        const match = out.match(/id\s*=\s*["']?([a-f0-9]{32})["']?/)
        if (!match) throw new Error(`KV id 파싱 실패\n출력:\n${out}`)
        kvId = match[1]
        console.log(green(`  ✅ ${kvId.slice(0, 8)}...`))
    } catch (e) {
        console.log(red(`  ✗\n  ${e.message}`))
        process.exit(1)
    }

    // ── Step 2: D1 database 생성 ──────────────────────────────────────────
    process.stdout.write(`  ${bold("2/7")} D1 database 생성...`)
    let d1Id
    try {
        const out = shellWrangler(`npx wrangler d1 create ${d1Name}`)
        const match = out.match(/database_id\s*=\s*["']?([a-f0-9-]{36})["']?/)
        if (!match) throw new Error(`D1 id 파싱 실패\n출력:\n${out}`)
        d1Id = match[1]
        console.log(green(`  ✅ ${d1Id.slice(0, 8)}...`))
    } catch (e) {
        console.log(red(`  ✗\n  ${e.message}`))
        process.exit(1)
    }

    // ── Step 3: wrangler.toml에 env 블록 추가 ─────────────────────────────
    process.stdout.write(`  ${bold("3/7")} wrangler.toml 업데이트...`)
    try {
        const wranglerPath = join(FRAMER_SYNC_DIR, "wrangler.toml")
        const existing = readFileSync(wranglerPath, "utf8")
        const block = `
# ── ${name} ──────────────────────────────────────────────────
[env.${envKey}]
name = "${workerName}"

[[env.${envKey}.kv_namespaces]]
binding = "KV"
id = "${kvId}"

[[env.${envKey}.d1_databases]]
binding = "DB"
database_name = "${d1Name}"
database_id = "${d1Id}"

[[env.${envKey}.r2_buckets]]
binding = "R2"
bucket_name = "framer-sync-webp-cache"

[[env.${envKey}.services]]
binding = "CONTROL_TOWER"
service = "control-tower-worker"

[env.${envKey}.triggers]
crons = ["0 0 */5 * *"]
`
        writeFileSync(wranglerPath, existing + block)
        console.log(green(`  ✅ [env.${envKey}] 추가`))
    } catch (e) {
        console.log(red(`  ✗ ${e.message}`))
        process.exit(1)
    }

    // ── Step 4: D1 마이그레이션 적용 ─────────────────────────────────────
    process.stdout.write(`  ${bold("4/7")} D1 마이그레이션 적용...`)
    try {
        shellWrangler(`npx wrangler d1 migrations apply ${d1Name} --env ${envKey}`)
        console.log(green(`  ✅`))
    } catch (e) {
        // 마이그레이션 실패 시 경고만 — 배포 자체는 계속
        console.log(yellow(`  ⚠️ ${e.message.split("\n")[0]} — 나중에 수동 적용 가능`))
    }

    // ── Step 5: 워커 배포 ────────────────────────────────────────────────
    process.stdout.write(`  ${bold("5/7")} 워커 배포...`)
    try {
        shellWrangler(`npx wrangler deploy --env ${envKey}`)
        console.log(green(`  ✅`))
    } catch (e) {
        console.log(red(`  ✗\n  ${e.message}`))
        process.exit(1)
    }

    // ── Step 6: cache bust (Cloudflare 가 SSOT — deploy 자체가 등록) + configure ─────
    bustWorkersCache()
    process.stdout.write(`  ${bold("6/6")} configure 실행... (배포 반영 대기 중)`)
    await new Promise(r => setTimeout(r, 3000))
    process.stdout.write("\r" + " ".repeat(60) + "\r")
    process.stdout.write(`  ${bold("6/6")} configure 실행...`)
    try {
        const res = await fetch(`${workerUrl}/configure`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                airtableBaseId,
                airtableToken,
                framerProjectUrl,
                framerToken: framerApiKey,
                ...(gtmId ? { gtmContainerId: gtmId } : {}),
            }),
            signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        console.log(green(`  ✅`))
    } catch (e) {
        console.log(yellow(`  ⚠️ ${e.message}`))
        console.log(dim(`     수동 실행: workerCtl.mjs ${name} configure`))
    }

    console.log()
    console.log(green(`  ✅ 프로비저닝 완료`))
    console.log()
    console.log(`  ${bold("워커")}   ${cyan(workerUrl)}`)
    console.log(`  ${bold("D1")}     ${gray(d1Name)} ${dim(`(${d1Id?.slice(0, 8)}...)`)}}`)
    console.log(`  ${bold("KV")}     ${gray(kvId?.slice(0, 8) + "...")}`)
    console.log()
    console.log(dim(`  초기 sync: workerCtl.mjs ${name} push-managed`))
    console.log()
}

// ── conduct ───────────────────────────────────────────────────────────────
// findClavierHq 는 lib/repoPaths.mjs 에서 import (sibling-first)

async function runConduct(workers) {
    await runPanel(workers)

    const hqDir = findClavierHq()
    if (!hqDir) {
        console.log(yellow("  clavier-hq 위치 못 찾음 — WORKER_STATUS.md 생성 생략"))
        return
    }

    const results = await Promise.allSettled(
        workers.map(async w => ({ worker: w, status: await fetchStatus(w.url) }))
    )

    const lines = []
    lines.push("# Worker Status (Auto-Generated)")
    lines.push("")
    lines.push(`> **이 파일은 자동 생성됨** — 수동 편집 금지. \`workerCtl conduct\` 실행으로 갱신.`)
    lines.push(`> 마지막 갱신: ${new Date().toISOString()}`)
    lines.push(`> 진실의 원천 (런타임): 각 워커의 D1 / 스냅샷: \`clavier-scripts/tools/worker-snapshots/\``)
    lines.push("")
    lines.push("---")
    lines.push("")

    results.forEach((r, i) => {
        const w = workers[i]
        lines.push(`## ${w.name}`)
        lines.push("")
        if (r.status === "fulfilled") {
            const s = r.value.status
            lines.push("| 항목 | 값 |")
            lines.push("|------|-----|")
            lines.push(`| Worker URL | ${w.url} |`)
            lines.push(`| Worker | ${s.worker ?? "—"} v${s.version ?? "—"} |`)
            lines.push(`| Configured | ${s.configured ? "✅" : "❌"} |`)
            if (s.airtableBaseId) lines.push(`| Airtable Base | \`${s.airtableBaseId}\` |`)
            if (s.framerProjectUrl) lines.push(`| Framer URL | ${s.framerProjectUrl} |`)
            if (s.gtmContainerId !== undefined) lines.push(`| GTM Container | ${s.gtmContainerId ?? "_미설정_"} |`)
            if (s.tables?.length) {
                const tables = s.tables.map(t => `${t.name}(${t.fields})`).join(", ")
                lines.push(`| 테이블 | ${tables} |`)
            }
            if (s.sync) {
                lines.push(`| 마지막 싱크 | ${s.sync.lastSync ?? "—"} (${s.sync.status ?? "—"}) |`)
            }
        } else {
            lines.push(`⚠️ 연결 실패: ${r.reason?.message ?? "unknown"}`)
        }
        lines.push("")
    })

    const outFile = join(hqDir, "WORKER_STATUS.md")
    writeFileSync(outFile, lines.join("\n"))
    console.log(dim(`  📄 WORKER_STATUS.md 갱신: ${outFile}`))
    console.log()
}

// ── 전체 브리핑 ───────────────────────────────────────────────────────────
async function showBriefing(workers) {
    const hr = gray("  " + "─".repeat(54))

    console.log(bold("  📡 시스템 브리핑"))
    console.log()

    const results = await Promise.allSettled(
        workers.map(w => fetchCapabilities(w.url).then(caps => ({ worker: w, caps })))
    )

    let anyOk = false
    results.forEach((r, i) => {
        const w = workers[i]
        if (r.status === "fulfilled") {
            anyOk = true
            const { caps } = r.value
            const statusBadge = caps.configured ? green("✅ 설정됨") : yellow("⚠️  미설정")
            const ver = caps.version ? dim(`v${caps.version}`) : ""
            console.log(`  ${bold(w.label ?? w.name)}  ${statusBadge}  ${ver}`)
            console.log(`  ${gray(w.url)}`)
            if (caps.functions?.length) {
                const fnList = caps.functions.map(f => cyan(f.id)).join("  ")
                console.log(`  ${dim("함수:")} ${fnList}`)
            }
        } else {
            console.log(`  ${bold(w.label ?? w.name)}  ${red("✗ 연결 실패")}`)
            console.log(`  ${gray(w.url)}`)
            console.log(`  ${dim(r.reason?.message ?? "알 수 없는 오류")}`)
        }
        console.log()
    })

    console.log(hr)
    console.log()

    return anyOk
}

// ── 메인 ──────────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2)
    const workers = await loadWorkers()

    console.log()
    console.log(bold(cyan("  🔧 workerCtl")))
    console.log()

    if (args[0] === "--help" || args[0] === "-h") {
        showHelp(workers)
        process.exit(0)
    }

    if (args[0] === "panel") {
        await runPanel(workers)
        process.exit(0)
    }

    if (args[0] === "conduct") {
        await runConduct(workers)
        process.exit(0)
    }

    if (args[0] === "backup") {
        await runBackup(workers)
        process.exit(0)
    }

    // register — 새 워커 등록 + configure
    if (args[0] === "register") {
        await runRegister(args.slice(1))
        process.exit(0)
    }

    if (!args[0]) {
        const anyOk = await showBriefing(workers)
        if (!anyOk) {
            console.error(red("  모든 워커에 연결할 수 없습니다. 네트워크 또는 URL을 확인하세요."))
            process.exit(1)
        }
    }

    // all <함수> — 모든 워커에 동일 함수 일괄 실행
    if (args[0] === "all" && args[1]) {
        const fnId = args[1]
        console.log(bold(`  📡 전체 워커 일괄 실행: ${cyan(fnId)}`))
        console.log()

        let body = null
        const firstCaps = await fetchCapabilities(workers[0].url).catch(() => null)
        const fnMeta = firstCaps?.functions?.find(f => f.id === fnId)
        if (fnMeta?.params?.length) {
            const rl = createInterface({ input: process.stdin, output: process.stdout })
            body = await collectParams(rl, fnMeta.params)
            rl.close()
        }

        const results = await Promise.allSettled(
            workers.map(async w => {
                const caps = await fetchCapabilities(w.url)
                const fn = caps.functions?.find(f => f.id === fnId)
                if (!fn) throw new Error(`함수 없음`)
                const res = await fetch(`${w.url}${fn.path}`, {
                    method: fn.method ?? "POST",
                    headers: { "Content-Type": "application/json" },
                    ...(body ? { body: JSON.stringify(body) } : {}),
                    signal: AbortSignal.timeout(120_000),
                })
                return { worker: w, ok: res.ok, status: res.status }
            })
        )

        results.forEach((r, i) => {
            const w = workers[i]
            if (r.status === "fulfilled") {
                const { ok, status } = r.value
                console.log(`  ${ok ? green("✅") : red("✗")}  ${bold(w.label ?? w.name)}  ${ok ? "" : red(`HTTP ${status}`)}`)
            } else {
                console.log(`  ${red("✗")}  ${bold(w.label ?? w.name)}  ${dim(r.reason?.message)}`)
            }
        })
        console.log()
        process.exit(0)
    }

    // ① 워커 결정
    let worker
    if (args[0] && args[0] !== "all") {
        worker = workers.find(w => w.name === args[0] || w.label?.toLowerCase().includes(args[0].toLowerCase()))
        if (!worker) {
            console.error(red(`  ✗ 워커 "${args[0]}" 를 찾을 수 없습니다`))
            console.log(gray(`  사용 가능: all, ${workers.map(w => w.name).join(", ")}`))
            process.exit(1)
        }
        console.log(`  워커: ${bold(worker.label ?? worker.name)}`)
        console.log()
    } else {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        console.log(bold("  워커 선택:"))
        console.log()
        worker = await selectFromList(rl, workers, w => `${bold(w.label ?? w.name)}  ${dim(w.url)}`)
        rl.close()
        console.log()
    }

    // ② capabilities 조회
    process.stdout.write(gray("  capabilities 조회 중..."))
    let caps
    try {
        caps = await fetchCapabilities(worker.url)
        process.stdout.write("\r" + " ".repeat(30) + "\r")
    } catch (err) {
        process.stdout.write("\n")
        console.error(red(`  ✗ ${err.message}`))
        process.exit(1)
    }

    if (!caps.functions?.length) {
        console.error(red("  ✗ 이 워커에 실행 가능한 함수가 없습니다"))
        process.exit(1)
    }

    // ③ 함수 결정
    let fn
    if (args[1]) {
        fn = caps.functions.find(f => f.id === args[1])
        if (!fn) {
            console.error(red(`  ✗ 함수 "${args[1]}" 를 찾을 수 없습니다`))
            console.log(gray(`  사용 가능: ${caps.functions.map(f => f.id).join(", ")}`))
            process.exit(1)
        }
        console.log(`  함수: ${bold(fn.label)}`)
        console.log()
    } else {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        console.log(bold(`  실행할 기능 (${caps.configured ? green("설정됨") : red("미설정")}):`) )
        console.log()
        fn = await selectFromList(
            rl,
            caps.functions,
            f => {
                const base = `${bold(f.label)}  ${dim(f.description ?? "")}`
                return f.constraint ? base + `  ${yellow("[" + f.constraint + "]")}` : base
            }
        )
        rl.close()
    }

    // ④ params 수집 (필요한 경우)
    // 워커별 Doppler config 라우팅 — sisoso=prd, mukayu=prd_mukayu (workerEnvMap.mjs SSOT)
    const wenv = getWorkerEnv(worker.name)
    const dopplerConfig = wenv?.dopplerConfig ?? "prd"

    let body = null
    if (fn.params?.length) {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        let current = {}
        if (fn.currentFrom) {
            try {
                const res = await fetch(`${worker.url}${fn.currentFrom}`, { signal: AbortSignal.timeout(5_000) })
                if (res.ok) current = await res.json()
            } catch { /* 조회 실패 → current = {} */ }
        }

        // configure: framerToken 은 (url, token) 쌍 단위로 별도 처리 — 일반 envKey 자동 주입 비활성화
        const isConfigure = fn.id === "configure"
        const paramsForCollect = isConfigure
            ? fn.params.filter(p => p.key !== "framerToken")
            : fn.params

        body = await collectParams(rl, paramsForCollect, current)

        // configure 후처리: 새 projectUrl 입력 시 (url, token) 매핑 조회/등록
        if (isConfigure && body.framerProjectUrl) {
            const projectId = extractFramerProjectId(body.framerProjectUrl)
            if (!projectId) {
                console.error(red(`  ✗ Framer URL 에서 project ID(20자) 추출 실패`))
                console.error(dim(`    형식: https://framer.com/projects/<slug>--<projectId>(-<viewId>)`))
                rl.close()
                process.exit(1)
            }
            const projects = loadFramerProjects(dopplerConfig)
            let entry = projects[projectId]
            if (entry?.token) {
                console.log(dim(`  ✓ Framer API 토큰 자동 적용 — Doppler[${dopplerConfig}] ${FRAMER_PROJECTS_KEY}.${projectId}`))
                entry.url = body.framerProjectUrl   // 입력 URL이 더 최신 (viewId 등) — 갱신
                projects[projectId] = entry
                try { saveFramerProjects(projects, dopplerConfig, worker.name) }
                catch (e) { console.log(yellow(`  ⚠️  ${FRAMER_PROJECTS_KEY} 갱신 실패 (무시 가능): ${e.message}`)) }
            } else {
                console.log()
                console.log(yellow(`  ⚠️  처음 보는 Framer 프로젝트 (id: ${projectId})`))
                console.log(`     이 프로젝트의 ${bold("Framer API 토큰")} 을 입력해주세요.`)
                console.log(dim(`     Doppler[${dopplerConfig}] ${FRAMER_PROJECTS_KEY}.${projectId} 에 (url, token) 쌍으로 저장됩니다.`))
                const token = (await prompt(rl, `  ${bold("Framer API 토큰")}: `)).trim()
                if (!token) {
                    console.error(red("  ✗ 토큰 필수 — 중단"))
                    rl.close()
                    process.exit(1)
                }
                entry = { url: body.framerProjectUrl, token }
                projects[projectId] = entry
                saveFramerProjects(projects, dopplerConfig, worker.name)
                console.log(green(`  ✓ Doppler[${dopplerConfig}] 저장: ${FRAMER_PROJECTS_KEY}.${projectId}`))
            }
            body.framerToken = entry.token

            // FRAMER_PROJECT_ID 도 Doppler 에 set — 워커는 env-first SSOT 라 D1 만 갱신해도 무시됨 (config.ts:40)
            try {
                setDopplerSecret("FRAMER_PROJECT_ID", projectId, dopplerConfig)
                console.log(dim(`  ↳ Doppler[${dopplerConfig}] FRAMER_PROJECT_ID = ${projectId}`))
            } catch (e) { console.log(yellow(`  ⚠️  FRAMER_PROJECT_ID 저장 실패: ${e.message}`)) }
        }

        // configure 후처리: airtableBaseId 변경 시 Doppler 에도 저장 (env-first SSOT — D1 만 갱신하면 무시됨)
        if (isConfigure && body.airtableBaseId && body.airtableBaseId !== current.airtableBaseId) {
            try {
                setDopplerSecret("AIRTABLE_BASE_ID", body.airtableBaseId, dopplerConfig)
                console.log(dim(`  ↳ Doppler[${dopplerConfig}] AIRTABLE_BASE_ID = ${body.airtableBaseId}`))
                syncDopplerToWrangler(worker.name)
            } catch (e) { console.log(yellow(`  ⚠️  AIRTABLE_BASE_ID 저장 실패: ${e.message}`)) }
        }

        rl.close()
    }

    // constraint 경고 표시
    if (fn.constraint) {
        console.log(yellow(`  ⚠️  ${fn.constraint}`))
        console.log()
    }

    // ⑤ 실행
    const ok = await runFunction(worker.url, fn, body)
    process.exit(ok ? 0 : 1)
}

main().catch(err => {
    console.error(red(`\n  ✗ 예기치 않은 오류: ${err.message}`))
    process.exit(1)
})
