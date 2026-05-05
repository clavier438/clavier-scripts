#!/usr/bin/env node
/**
 * Ray Dalio runner — 매일 새벽 03:30 launchd 가 호출
 *
 * STL 원칙 (DECISIONS.md 2026-05-04 + 2026-05-05 ADR):
 * Ray Dalio = 매일 03:30 영역의 단일 책임 루틴. 사용자 직접 보고.
 *
 * 책무 (clavier-hq/ray-dalio-prompt.md 참조):
 *   1. RAY_DALIO_QUEUE.md 의 ## 대기 중 미체크 실수 읽음
 *   2. 5 whys → 근본 원인 → 강제 hook 4 layer 구현
 *   3. PRINCIPLES.md 에 P{n} 영구 누적 (사용자 핵심 산출물)
 *   4. briefings/rayDalio-YYYY-MM-DD.md 보고서
 *   5. 큐 항목 ✅ + commit + push
 *   6. 사용자 결정 필요 ⚠️ macOS 알림
 *
 * 동작:
 *   - claude --dangerously-skip-permissions -p "$(cat ray-dalio-prompt.md)"
 *   - claude 가 모든 작업 자율 실행 (큐 읽기 / 5 whys / hook 구현 / commit / 보고서)
 *
 * 수동 실행:
 *   node tools/ray-dalio-runner.mjs
 *   node tools/ray-dalio-runner.mjs --dry
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { execSync } from "child_process"
import { join } from "path"
import { findClavierHq } from "./lib/repoPaths.mjs"

// claude 바이너리 경로 (closer-runner 와 동일 패턴)
const CLAUDE_BIN = (() => {
    if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
    const home = process.env.HOME ?? ""
    for (const p of [`${home}/.local/bin/claude`, "/usr/local/bin/claude", "/opt/homebrew/bin/claude"]) {
        if (existsSync(p)) return p
    }
    try {
        const out = execSync("command -v claude", { encoding: "utf8" }).trim()
        if (out) return out
    } catch { /* not found */ }
    return null
})()

const HQ = findClavierHq()
if (!HQ) {
    console.error("clavier-hq 경로 못 찾음. CLAVIER_HQ env 또는 sibling 클론 필요.")
    process.exit(1)
}

const PROMPT_PATH = join(HQ, "ray-dalio-prompt.md")
const QUEUE_PATH = join(HQ, "RAY_DALIO_QUEUE.md")
const BRIEFINGS_DIR = join(HQ, "briefings")
const DRY = process.argv.includes("--dry")

function today() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function pendingCount() {
    if (!existsSync(QUEUE_PATH)) return 0
    const text = readFileSync(QUEUE_PATH, "utf8")
    const lines = text.split("\n")
    let inPending = false
    let count = 0
    for (const line of lines) {
        if (/^##\s+대기 중/.test(line)) { inPending = true; continue }
        if (inPending && /^##\s/.test(line)) break
        if (inPending && /^-\s*\[\s*\]\s/.test(line)) count++
    }
    return count
}

async function main() {
    if (!CLAUDE_BIN || !existsSync(CLAUDE_BIN)) {
        console.error(`❌ claude 바이너리 없음: ${CLAUDE_BIN}`)
        process.exit(1)
    }
    if (!existsSync(PROMPT_PATH)) {
        console.error(`❌ ray-dalio-prompt.md 없음: ${PROMPT_PATH}`)
        process.exit(1)
    }
    if (!existsSync(QUEUE_PATH)) {
        console.error(`⚠️  RAY_DALIO_QUEUE.md 없음 — 빈 보고서로 종료`)
        process.exit(0)
    }

    const pending = pendingCount()
    console.log(`# Ray Dalio runner — ${new Date().toISOString()}`)
    console.log(`대기 중 실수: ${pending}개`)

    if (pending === 0) {
        // 큐 비어있어도 보고서는 작성 (어제 박힌 hook 회귀 검증)
        console.log("(빈 큐 — 회귀 검증만)")
    }

    // claude 실행 — ray-dalio-prompt.md 본문 그대로 + 큐가 path 로 prompt 안에 박힘
    const cmd = `cd "${HQ}" && "${CLAUDE_BIN}" --dangerously-skip-permissions -p "$(cat '${PROMPT_PATH}')"`

    if (DRY) {
        console.log("[DRY RUN] 실행 안 함")
        console.log(cmd)
        return
    }

    let output = ""
    let ok = true
    try {
        output = execSync(cmd, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 1800_000, // 30분 한도
            maxBuffer: 10 * 1024 * 1024,
        })
    } catch (e) {
        ok = false
        output = (e.stdout ?? "") + (e.stderr ?? "") + "\n" + e.message
    }

    // briefings/rayDalio-YYYY-MM-DD.md 는 ray-dalio-prompt 가 자체 작성 (Step 5).
    // 여기서는 *runner 자체 로그* 만 별도 저장 (실행 결과 진단용).
    mkdirSync(BRIEFINGS_DIR, { recursive: true })
    const runnerLogFile = join(BRIEFINGS_DIR, `rayDalio-runner-${today()}.log`)
    writeFileSync(runnerLogFile, `# Ray Dalio runner log — ${new Date().toISOString()}\n\n` +
        `pending: ${pending}\nok: ${ok}\n\n## output\n\n${output}\n`)

    console.log(output)
    console.log(`\n로그: ${runnerLogFile}`)

    // 사용자 결정 필요 알림 — briefing 안 ⚠️ 카운트 grep
    const briefingFile = join(BRIEFINGS_DIR, `rayDalio-${today()}.md`)
    if (existsSync(briefingFile)) {
        const briefing = readFileSync(briefingFile, "utf8")
        const userDecisionMatch = briefing.match(/사용자 결정 필요[^\n]*\n([\s\S]*?)(?:\n##|$)/)
        const hasUserDecision = userDecisionMatch && /⚠️|🔴/.test(userDecisionMatch[1])
        if (hasUserDecision) {
            try {
                execSync(`osascript -e 'display notification "Ray Dalio: ⚠️ 사용자 결정 필요 — briefing 확인" with title "🚨 Ray Dalio 새벽 보고"'`)
            } catch (_) { /* 알림 실패 무시 */ }
        }
    }

    if (!ok) process.exit(1)
}

main().catch(e => {
    console.error("치명적 오류:", e)
    process.exit(1)
})
