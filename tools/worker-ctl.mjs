#!/usr/bin/env node
/**
 * worker-ctl — Cloudflare Worker 제어 CLI
 *
 * 사용법:
 *   worker-ctl                        # 대화형 (워커 선택 → 함수 선택)
 *   worker-ctl <워커이름>              # 워커 지정 후 함수 선택
 *   worker-ctl <워커이름> <함수id>     # 바로 실행
 *
 * 예시:
 *   worker-ctl
 *   worker-ctl sisoso
 *   worker-ctl sisoso sync-to-framer
 */

import { createInterface } from "readline"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dir = dirname(fileURLToPath(import.meta.url))
const WORKERS_JSON = join(__dir, "workers.json")

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
const bold  = s => `${c.bold}${s}${c.reset}`
const dim   = s => `${c.dim}${s}${c.reset}`
const cyan  = s => `${c.cyan}${s}${c.reset}`
const green = s => `${c.green}${s}${c.reset}`
const red   = s => `${c.red}${s}${c.reset}`
const gray  = s => `${c.gray}${s}${c.reset}`

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
function loadWorkers() {
    try {
        return JSON.parse(readFileSync(WORKERS_JSON, "utf8"))
    } catch {
        console.error(red("✗ workers.json 읽기 실패: ") + WORKERS_JSON)
        process.exit(1)
    }
}

// ── /capabilities 호출 ────────────────────────────────────────────────────
async function fetchCapabilities(workerUrl) {
    const res = await fetch(`${workerUrl}/capabilities`, {
        signal: AbortSignal.timeout(10_000),
    }).catch(err => { throw new Error(`연결 실패: ${err.message}`) })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

// ── 함수 실행 ─────────────────────────────────────────────────────────────
async function runFunction(workerUrl, fn) {
    const url = `${workerUrl}${fn.path}`
    const method = fn.method ?? "POST"

    console.log()
    console.log(gray(`  ${method} ${url}`))
    console.log()

    const start = Date.now()
    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
    }).catch(err => { throw new Error(`요청 실패: ${err.message}`) })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    let body
    try { body = await res.json() }
    catch { body = await res.text() }

    if (res.ok) {
        console.log(green(`  ✅ 완료 (${elapsed}s)`))
    } else {
        console.log(red(`  ✗ 오류 (HTTP ${res.status}, ${elapsed}s)`))
    }

    console.log()
    console.log(JSON.stringify(body, null, 2).split("\n").map(l => `  ${l}`).join("\n"))
    console.log()

    return res.ok
}

// ── 메인 ──────────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2)
    const workers = loadWorkers()

    console.log()
    console.log(bold(cyan("  🔧 Worker Control")))
    console.log()

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

    // ④ 실행
    const ok = await runFunction(worker.url, fn)
    process.exit(ok ? 0 : 1)
}

main().catch(err => {
    console.error(red(`\n  ✗ 예기치 않은 오류: ${err.message}`))
    process.exit(1)
})
