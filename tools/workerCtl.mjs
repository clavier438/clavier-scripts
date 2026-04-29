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
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { homedir } from "os"

// ~/.clavier/env 자동 로드 — 터미널 밖 실행 시에도 동작
try {
    const envFile = join(homedir(), ".clavier", "env")
    readFileSync(envFile, "utf8").split("\n").forEach(line => {
        line = line.trim()
        if (!line || line.startsWith("#") || !line.includes("=")) return
        const [k, ...rest] = line.split("=")
        const key = k.trim()
        if (!process.env[key]) process.env[key] = rest.join("=").trim()
    })
} catch { /* ~/.clavier/env 없으면 shell env 사용 */ }

const __dir = dirname(fileURLToPath(import.meta.url))

const WORKERS_JSON = (() => {
    const candidates = [
        join(__dir, "workers.json"),
        join(process.env.HOME ?? "", "Library/Mobile Documents/com~apple~CloudDocs/0/scripts/tools/workers.json"),
    ]
    return candidates.find(p => existsSync(p)) ?? candidates[0]
})()

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
const REGISTRY_URL = process.env.REGISTRY_URL ?? "https://clavier-registry.hyuk439.workers.dev"

async function loadWorkers() {
    try {
        const res = await fetch(`${REGISTRY_URL}/workers`, { signal: AbortSignal.timeout(5_000) })
        if (res.ok) return await res.json()
    } catch {
        // 오프라인 또는 레지스트리 오류 → 로컬 fallback
    }
    try {
        return JSON.parse(readFileSync(WORKERS_JSON, "utf8"))
    } catch {
        console.error(red("✗ workers.json 읽기 실패 (레지스트리도 오프라인): ") + WORKERS_JSON)
        process.exit(1)
    }
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
async function pollUntilComplete(workerUrl, triggerTimeMs, maxWaitMs = 15 * 60 * 1000) {
    const start = Date.now()
    let dotCount = 0
    while (Date.now() - start < maxWaitMs) {
        await new Promise(r => setTimeout(r, 3000))

        const elapsed = ((Date.now() - start) / 1000).toFixed(0)
        const dots = ".".repeat((dotCount++ % 3) + 1).padEnd(3)
        process.stdout.write(`\r  ${gray(`백그라운드 작업 진행 중${dots} (${elapsed}s 경과)`)}     `)

        try {
            const res = await fetch(`${workerUrl}/status`, { signal: AbortSignal.timeout(5000) })
            if (!res.ok) continue
            const status = await res.json()
            const lastSyncRaw = status?.sync?.lastSync
            if (!lastSyncRaw) {
                process.stdout.write("\r" + " ".repeat(60) + "\r")
                return null
            }
            const lastSyncTime = new Date(lastSyncRaw).getTime()
            if (lastSyncTime > triggerTimeMs) {
                process.stdout.write("\r" + " ".repeat(60) + "\r")
                return status.sync
            }
        } catch { /* 일시적 오류 → 다음 시도 */ }
    }
    process.stdout.write("\r" + " ".repeat(60) + "\r")
    return null
}

// ── NDJSON 스트리밍 함수 실행 (sync-full 전용) ───────────────────────────
async function runFunctionStreaming(workerUrl, fn) {
    const url = `${workerUrl}${fn.path}`
    const method = fn.method ?? "POST"

    console.log()
    console.log(gray(`  ${method} ${url}`))
    console.log()

    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(180_000), // 3분 — Framer connect(90s) + 처리 버퍼
    }).catch(err => { throw new Error(`요청 실패: ${err.message}`) })

    if (!res.ok) {
        let errBody
        try { errBody = await res.text() } catch { errBody = "" }
        console.log(red(`  ✗ HTTP ${res.status}`))
        if (errBody) console.log(gray(`  ${errBody}`))
        return false
    }

    // NDJSON 라인별 파싱 + 실시간 출력
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let success = true

    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
            if (!line.trim()) continue
            let obj
            try { obj = JSON.parse(line) }
            catch { console.log(gray(`  ${line}`)); continue }

            const ts = obj.ts ? gray(` (${new Date(obj.ts).toLocaleTimeString("ko-KR")})`) : ""

            if (obj.step === "stage1") {
                console.log(cyan(`  ▸ Stage 1 완료${ts}`))
                for (const s of obj.summaries ?? []) {
                    console.log(`    ${bold(s.collection.padEnd(14))} upserted=${s.upserted} skipped=${s.skippedNoSlug}`)
                }
                console.log()
            } else if (obj.step === "stage2") {
                if ("error" in obj) {
                    console.log(red(`  ▸ Stage 2 [${obj.collection}] ✗ ${obj.error}${ts}`))
                    success = false
                } else {
                    const parts = [`added=${obj.added}`, `updated=${obj.updated}`, `skipped=${obj.skipped}`]
                    console.log(green(`  ▸ Stage 2 [${obj.collection}] ${parts.join(" ")}${ts}`))
                }
            } else if (obj.step === "done") {
                console.log()
                console.log(green(`  ✅ Full Sync 완료${ts}`))
            } else if (obj.step === "error") {
                console.log()
                console.log(red(`  ✗ 오류: ${obj.message}${ts}`))
                success = false
            } else {
                console.log(gray(`  ${JSON.stringify(obj)}`))
            }
        }
    }

    console.log()
    return success
}

// ── 일반 함수 실행 ────────────────────────────────────────────────────────
async function runFunction(workerUrl, fn, body = null) {
    // streaming: true 플래그 → NDJSON 스트리밍 모드
    if (fn.streaming) {
        return runFunctionStreaming(workerUrl, fn)
    }

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
    console.log(JSON.stringify(responseBody, null, 2).split("\n").map(l => `  ${l}`).join("\n"))
    console.log()

    // 비동기 작업 감지: 응답 메시지에 "시작됨"/"started" → status polling
    if (res.ok && typeof responseBody === "object" && responseBody !== null) {
        const noteText = String(responseBody.note ?? responseBody.message ?? "")
        const isAsync = /시작됨|started/i.test(noteText)
        if (isAsync) {
            const finalStatus = await pollUntilComplete(workerUrl, triggerTime)
            if (finalStatus) {
                const totalElapsed = ((Date.now() - triggerTime) / 1000).toFixed(0)
                const ok = finalStatus.status === "ok"
                console.log(ok
                    ? green(`  ✅ 백그라운드 작업 완료 (총 ${totalElapsed}s)`)
                    : red(`  ✗ 백그라운드 작업 실패 (총 ${totalElapsed}s)`))
                console.log()
                console.log(JSON.stringify(finalStatus, null, 2).split("\n").map(l => `  ${l}`).join("\n"))
                console.log()
                return ok
            } else {
                console.log(yellow(`  ⚠️ 백그라운드 작업 상태 확인 불가 (timeout 또는 /status 미지원)`))
                console.log(dim(`     수동 확인: workerCtl ${workerUrl.split("//")[1].split(".")[0]} status`))
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
    console.log(`    ${cyan("workerCtl")}                    ${dim("전체 브리핑 후 대화형 실행")}`)
    console.log(`    ${cyan("workerCtl --help")}             ${dim("이 도움말")}`)
    console.log(`    ${cyan("workerCtl panel")}              ${dim("모든 워커 상태 표 출력 + 스냅샷 저장")}`)
    console.log(`    ${cyan("workerCtl conduct")}            ${dim("panel + WORKER_STATUS.md 자동 갱신")}`)
    console.log(`    ${cyan("workerCtl backup")}             ${dim("모든 워커 상태 → Airtable system_snapshots 저장")}`)
    console.log(`    ${cyan("workerCtl <워커>")}             ${dim("워커 지정 → 함수 선택")}`)
    console.log(`    ${cyan("workerCtl <워커> <함수>")}      ${dim("바로 실행")}`)
    console.log()
    console.log(hr)
    console.log()

    console.log(bold("  등록된 워커  ") + dim(`(${WORKERS_JSON})`))
    console.log()
    workers.forEach(w => {
        console.log(`    ${bold(cyan(w.name.padEnd(16)))} ${w.label ?? ""}`)
        console.log(`    ${dim(" ".repeat(16))} ${gray(w.url)}`)
        console.log()
    })
    console.log(hr)
    console.log()

    console.log(bold("  2-stage 파이프라인 (framer-sync 기준)"))
    console.log()
    console.log(`  ┌─ Stage 1: Airtable → D1 stage1_cache    ${dim("(Framer 호출 없음)")}`)
    console.log(`  └─ Stage 2: D1 stage1_cache → Framer      ${dim("(Airtable 호출 없음)")}`)
    console.log()

    const exampleFns = [
        ["sync-full",       "POST",  "Stage 1 + 2 전체 — NDJSON 스트리밍 (실시간 결과)"],
        ["sync-stage1",     "POST",  "Stage 1만 — Airtable → D1 (동기 응답)"],
        ["sync-stage2",     "POST",  "Stage 2만 — D1 → Framer (백그라운드 + polling)"],
        ["sync-to-framer",  "POST",  "Legacy — Airtable → Framer 직통 (구 방식)"],
        ["sync-to-airtable","POST",  "Framer → Airtable 역동기화"],
        ["status",          "GET ",  "상태, 설정값, 마지막 실행 결과 확인"],
        ["configure",       "POST",  "연결 설정 변경 (Airtable ID, Framer 토큰 등)"],
    ]
    console.log(`  ${bold("ID".padEnd(20))} ${"METHOD".padEnd(6)} 설명`)
    console.log(`  ${dim("─".repeat(60))}`)
    exampleFns.forEach(([id, method, desc]) => {
        console.log(`  ${cyan(id.padEnd(20))} ${gray(method.padEnd(6))} ${desc}`)
    })
    console.log()
    console.log(hr)
    console.log()

    console.log(bold("  예시"))
    console.log()
    console.log(`    ${dim("workerCtl")}                          ${dim("→ 전체 브리핑 + 대화형")}`)
    console.log(`    ${dim("workerCtl sisoso")}                   ${dim("→ sisoso 함수 선택")}`)
    console.log(`    ${dim("workerCtl sisoso status")}            ${dim("→ 상태 즉시 확인")}`)
    console.log(`    ${dim("workerCtl sisoso sync-full")}         ${dim("→ 전체 sync (실시간 스트리밍)")}`)
    console.log(`    ${dim("workerCtl sisoso sync-stage1")}       ${dim("→ Stage 1만 실행")}`)
    console.log(`    ${dim("workerCtl sisoso sync-stage2")}       ${dim("→ Stage 2만 실행")}`)
    console.log(`    ${dim("workerCtl sisoso configure")}         ${dim("→ 연결 설정 변경")}`)
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
const BACKUP_BASE  = "appfLfZUE4zVncTpY"
const BACKUP_TABLE = "tblXSf0epaEj4JY9F"

async function runBackup(workers) {
    const apiKey = process.env.AIRTABLE_API_KEY
    if (!apiKey) {
        console.error(red("  ✗ AIRTABLE_API_KEY 가 설정되지 않았습니다 (~/.clavier/env 확인)"))
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

// ── conduct ───────────────────────────────────────────────────────────────
function findClavierHq() {
    const candidates = [
        join(process.env.HOME ?? "", "Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/clavier-hq"),
        join(__dir, "..", "..", "..", "code", "projects", "clavier-hq"),
    ]
    return candidates.find(p => existsSync(p))
}

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
            f => `${bold(f.label)}  ${dim(f.description ?? "")}`
        )
        rl.close()
    }

    // ④ params 수집 (필요한 경우)
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
        body = await collectParams(rl, fn.params, current)
        rl.close()
    }

    // ⑤ 실행
    const ok = await runFunction(worker.url, fn, body)
    process.exit(ok ? 0 : 1)
}

main().catch(err => {
    console.error(red(`\n  ✗ 예기치 않은 오류: ${err.message}`))
    process.exit(1)
})
