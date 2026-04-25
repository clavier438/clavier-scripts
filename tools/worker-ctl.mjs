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
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

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
async function collectParams(rl, params) {
    const body = {}
    console.log()
    console.log(bold("  설정 값을 입력하세요:"))
    console.log(dim("  (선택 항목은 Enter로 건너뛸 수 있습니다 / env에서 로드된 값은 자동 적용)"))
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

        const tag    = p.required ? red("*필수") : dim("선택")
        const hint   = p.hint ? gray(` (${p.hint})`) : ""
        const envHint = p.envKey ? dim(` [$${p.envKey} 미설정]`) : ""
        const label  = `  ${bold(p.label)}${hint}${envHint} [${tag}]: `

        while (true) {
            const val = (await prompt(rl, label)).trim()
            if (val) { body[p.key] = val; break }
            if (!p.required) break
            console.log(red(`  ✗ 필수 항목입니다`))
        }
    }
    console.log()
    return body
}

// ── 함수 실행 ─────────────────────────────────────────────────────────────
async function runFunction(workerUrl, fn, body = null) {
    const url = `${workerUrl}${fn.path}`
    const method = fn.method ?? "POST"

    console.log()
    console.log(gray(`  ${method} ${url}`))
    console.log()

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
        console.log(green(`  ✅ 완료 (${elapsed}s)`))
    } else {
        console.log(red(`  ✗ 오류 (HTTP ${res.status}, ${elapsed}s)`))
    }

    console.log()
    console.log(JSON.stringify(responseBody, null, 2).split("\n").map(l => `  ${l}`).join("\n"))
    console.log()

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

    // 워커를 인수로 받지 않은 경우 → 브리핑 먼저
    if (!args[0]) {
        const anyOk = await showBriefing(workers)
        if (!anyOk) {
            console.error(red("  모든 워커에 연결할 수 없습니다. 네트워크 또는 URL을 확인하세요."))
            process.exit(1)
        }
    }

    // ① 워커 결정
    let worker
    if (args[0]) {
        worker = workers.find(w => w.name === args[0] || w.label?.toLowerCase().includes(args[0].toLowerCase()))
        if (!worker) {
            console.error(red(`  ✗ 워커 "${args[0]}" 를 찾을 수 없습니다`))
            console.log(gray(`  사용 가능: ${workers.map(w => w.name).join(", ")}`))
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
        body = await collectParams(rl, fn.params)
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
