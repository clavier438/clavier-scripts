#!/usr/bin/env node
/**
 * worker-ctl — Cloudflare Worker 제어 CLI
 *
 * 사용법:
 *   worker-ctl                        # 전체 브리핑 → 대화형 (워커 선택 → 함수 선택)
 *   worker-ctl --help                 # 상세 도움말
 *   worker-ctl <워커이름>              # 워커 지정 후 함수 선택
 *   worker-ctl <워커이름> <함수id>     # 바로 실행
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
// 클라우드 레지스트리 우선, 실패 시 로컬 workers.json fallback
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
// current: fn.currentFrom 으로 미리 조회한 현재 설정값 (없으면 {})
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
        // envKey가 있으면 로컬 환경변수에서 자동 로드
        const envVal = p.envKey ? process.env[p.envKey] : null
        if (envVal) {
            const preview = p.secret ? dim("***") : gray(envVal.slice(0, 20) + (envVal.length > 20 ? "…" : ""))
            console.log(`  ${bold(p.label)}: ${green("✓")} ${dim(`$${p.envKey}`)} ${preview}`)
            body[p.key] = envVal
            continue
        }

        // 현재 서버 설정값 (statusKey로 매핑)
        const currentVal = p.statusKey !== undefined ? current[p.statusKey] : undefined
        const hasExisting = currentVal === true || (typeof currentVal === "string" && currentVal.length > 0)

        // 기존 값 있으면 required 강제 해제
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
            if (hasExisting) break  // Enter → 서버에서 기존 KV 값 유지
            if (!p.required) break
            console.log(red(`  ✗ 필수 항목입니다`))
        }
    }
    console.log()
    return body
}

// ── 비동기 작업 status polling ────────────────────────────────────────────
// 워커가 백그라운드로 작업을 돌리는 경우 (응답에 "시작됨" 등) /status를 polling해서
// sync.lastSync 가 트리거 시점 이후로 갱신될 때까지 기다림.
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
                // /status에 sync 필드가 없는 워커 → polling 의미 없음 → 종료
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

// ── 함수 실행 ─────────────────────────────────────────────────────────────
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
        signal: AbortSignal.timeout(60_000),
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

    // 비동기 작업 감지: 응답 메시지에 "시작됨"/"started" 키워드 → status polling
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
                console.log(dim(`     수동 확인: worker-ctl ${workerUrl.split("//")[1].split(".")[0]} status`))
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
    console.log(bold(cyan("  🔧 worker-ctl — Cloudflare Worker 제어 CLI")))
    console.log()
    console.log(hr)
    console.log()

    console.log(bold("  사용법"))
    console.log()
    console.log(`    ${cyan("worker-ctl")}                    ${dim("전체 브리핑 후 대화형 실행")}`)
    console.log(`    ${cyan("worker-ctl --help")}             ${dim("이 도움말")}`)
    console.log(`    ${cyan("worker-ctl panel")}              ${dim("모든 워커 상태 표 출력 + 스냅샷 저장")}`)
    console.log(`    ${cyan("worker-ctl conduct")}            ${dim("panel + WORKER_STATUS.md 자동 갱신")}`)
    console.log(`    ${cyan("worker-ctl backup")}             ${dim("모든 워커 상태 → Airtable system_snapshots 저장")}`)
    console.log(`    ${cyan("worker-ctl <워커>")}             ${dim("워커 지정 → 함수 선택")}`)
    console.log(`    ${cyan("worker-ctl <워커> <함수>")}      ${dim("바로 실행")}`)
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

    console.log(bold("  함수 목록은 워커가 /capabilities 로 노출"))
    console.log()
    console.log(`  각 워커는 ${cyan("GET /capabilities")} 엔드포인트로 실행 가능한 함수를 선언합니다.`)
    console.log(`  worker-ctl 은 이 목록을 동적으로 읽어 메뉴로 제공합니다.`)
    console.log()

    const exampleFns = [
        ["status",          "GET ",  "상태, 설정값, 마지막 실행 결과 확인"],
        ["sync-to-framer",  "POST",  "Airtable → Framer CMS 동기화"],
        ["sync-to-airtable","POST",  "Framer 편집 내용 → Airtable 역동기화"],
        ["push",            "POST",  "일회성 Push (비관리형)"],
        ["set-config",      "POST",  "연결 설정 변경 (Airtable ID, Framer 토큰 등)"],
    ]
    console.log(`  ${bold("ID".padEnd(20))} ${"METHOD".padEnd(6)} 설명`)
    console.log(`  ${dim("─".repeat(52))}`)
    exampleFns.forEach(([id, method, desc]) => {
        console.log(`  ${cyan(id.padEnd(20))} ${gray(method.padEnd(6))} ${desc}`)
    })
    console.log()
    console.log(dim("  * set-config 는 워커 코드에 엔드포인트가 구현되어야 나타납니다."))
    console.log()
    console.log(hr)
    console.log()

    console.log(bold("  예시"))
    console.log()
    console.log(`    ${dim("worker-ctl")}                         ${dim("→ 전체 브리핑 + 대화형")}`)
    console.log(`    ${dim("worker-ctl sisoso")}                  ${dim("→ sisoso 함수 선택")}`)
    console.log(`    ${dim("worker-ctl sisoso status")}           ${dim("→ 상태 즉시 확인")}`)
    console.log(`    ${dim("worker-ctl sisoso sync-to-framer")}   ${dim("→ Airtable→Framer 동기화 즉시 실행")}`)
    console.log(`    ${dim("worker-ctl sisoso set-config")}       ${dim("→ 연결 설정 변경")}`)
    console.log()
    console.log(hr)
    console.log()

    console.log(bold("  구조 메모"))
    console.log()
    console.log(`  ┌─ workers.json       등록 워커 목록 (이름, URL)`)
    console.log(`  ├─ <worker>/capabilities  실행 가능 함수 선언 (동적)`)
    console.log(`  └─ worker-ctl         위를 읽어 대화형 CLI 제공`)
    console.log()
    console.log(`  워커들이 같은 코드 템플릿을 공유하면,`)
    console.log(`  템플릿 한 곳의 capabilities 수정이 모든 워커에 일괄 적용됩니다.`)
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

// ── panel: 모든 워커 /status를 표로 출력 + 스냅샷 저장 ──────────────────────
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

// ── backup: 모든 워커 /status → Airtable system_snapshots에 직접 insert ──
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

    // 모든 워커 /status 병렬 조회
    const results = await Promise.allSettled(
        workers.map(async w => ({
            worker: w,
            status: await fetchStatus(w.url),
        }))
    )

    const ts = new Date().toISOString()

    // 결과 표 헤더 (panel과 동일한 스타일)
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
        // Airtable multilineText 최대 100KB 제한
        const snapshotTruncated = snapshotStr.length > 100_000
            ? snapshotStr.slice(0, 100_000)
            : snapshotStr

        const fields = {
            id:               recordId,
            worker:           w.name,
            recordedAt:       ts,
            trigger:          "manual",
        }
        if (s.version           !== undefined) fields.version          = String(s.version)
        if (s.airtableBaseId    !== undefined) fields.airtableBaseId   = s.airtableBaseId
        if (s.framerProjectUrl  !== undefined) fields.framerProjectUrl = s.framerProjectUrl
        if (s.gtmContainerId    !== undefined) fields.gtmContainerId   = s.gtmContainerId
        fields.snapshotJson = snapshotTruncated

        try {
            const res = await fetch(
                `https://api.airtable.com/v0/${BACKUP_BASE}/${BACKUP_TABLE}`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ fields }),
                    signal: AbortSignal.timeout(15_000),
                }
            )
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

// ── conduct: panel + clavier-hq/WORKER_STATUS.md 자동 생성 ──────────────
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
    lines.push(`> **이 파일은 자동 생성됨** — 수동 편집 금지. \`worker-ctl conduct\` 실행으로 갱신.`)
    lines.push(`> 마지막 갱신: ${new Date().toISOString()}`)
    lines.push(`> 진실의 원천 (런타임): 각 워커의 KV / 스냅샷: \`clavier-scripts/tools/worker-snapshots/\``)
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

    // 모든 워커 capabilities 병렬 조회
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
    console.log(bold(cyan("  🔧 Worker Control")))
    console.log()

    // --help / -h
    if (args[0] === "--help" || args[0] === "-h") {
        showHelp(workers)
        process.exit(0)
    }

    // panel — 모든 워커 한 화면 표 + 스냅샷 저장
    if (args[0] === "panel") {
        await runPanel(workers)
        process.exit(0)
    }

    // conduct — panel + clavier-hq/WORKER_STATUS.md 자동 갱신
    if (args[0] === "conduct") {
        await runConduct(workers)
        process.exit(0)
    }

    // backup — 모든 워커 /status → Airtable system_snapshots 직접 insert
    if (args[0] === "backup") {
        await runBackup(workers)
        process.exit(0)
    }

    // 워커를 인수로 받지 않은 경우 → 브리핑 먼저
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

        // params는 첫 번째 워커 capabilities에서 가져와 한 번만 입력받음
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
                    signal: AbortSignal.timeout(60_000),
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
        // currentFrom이 있으면 현재 설정값 미리 조회 → Enter로 유지 기능
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
