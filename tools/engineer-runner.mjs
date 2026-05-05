#!/usr/bin/env node
/**
 * Engineer runner — 매주 일요일 03:30 launchd 가 호출
 *
 * STL 원칙 (DECISIONS.md 2026-05-04 ADR):
 * Engineer = 매주 일요일 03:30 영역의 단일 책임 루틴 (5번째). 사용자 직접 보고.
 *
 * 책무 (clavier-hq/engineer-prompt.md 참조):
 *   1. tools/ 디렉토리 inventory 수집
 *   2. 도메인별 그루핑 + 태깅 (one-off / reusable / deprecated / experimental)
 *   3. 명백한 sequence/duplicate 식별 (e.g., fillgaps1~5)
 *   4. CATALOG.md 갱신 (살아있는 카탈로그)
 *   5. ENGINEER_QUEUE.md 에 후보 박음 (사용자 승인 대기)
 *   6. 사용자 ✅ 체크한 항목 실행 (전 주에 박힌 것)
 *   7. briefings/engineer-YYYY-MM-DD.md 보고서
 *   8. commit + push, 사용자 결정 필요 ⚠️ macOS 알림
 *
 * 다른 루틴과 영역 분리:
 *   - Closer (매일 03:00) = overnight queue + 헬스
 *   - Ray Dalio (매일 03:30) = 실수 → 차단 hook
 *   - Engineer (매주 일 03:30) = tools/ 카탈로그 정리 ← 여기
 *
 * 수동 실행:
 *   node tools/engineer-runner.mjs
 *   node tools/engineer-runner.mjs --dry
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { execSync } from "child_process"
import { join } from "path"
import { findClavierHq } from "./lib/repoPaths.mjs"

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

const PROMPT_PATH = join(HQ, "engineer-prompt.md")
const QUEUE_PATH = join(HQ, "ENGINEER_QUEUE.md")
const CATALOG_PATH = join(HQ, "CATALOG.md")
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
    let inApproved = false
    let count = 0
    for (const line of lines) {
        if (/^##\s+사용자 승인/.test(line)) { inApproved = true; continue }
        if (inApproved && /^##\s/.test(line)) break
        if (inApproved && /^-\s*\[x\]\s/i.test(line)) count++
    }
    return count
}

async function main() {
    if (!CLAUDE_BIN || !existsSync(CLAUDE_BIN)) {
        console.error(`❌ claude 바이너리 없음: ${CLAUDE_BIN}`)
        process.exit(1)
    }
    if (!existsSync(PROMPT_PATH)) {
        console.error(`❌ engineer-prompt.md 없음: ${PROMPT_PATH}`)
        process.exit(1)
    }

    const approved = pendingCount()
    console.log(`# Engineer runner — ${new Date().toISOString()}`)
    console.log(`사용자 승인된 항목: ${approved}개`)

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
            timeout: 1800_000,
            maxBuffer: 10 * 1024 * 1024,
        })
    } catch (e) {
        ok = false
        output = (e.stdout ?? "") + (e.stderr ?? "") + "\n" + e.message
    }

    mkdirSync(BRIEFINGS_DIR, { recursive: true })
    const runnerLogFile = join(BRIEFINGS_DIR, `engineer-runner-${today()}.log`)
    writeFileSync(runnerLogFile, `# Engineer runner log — ${new Date().toISOString()}\n\n` +
        `approved-items: ${approved}\nok: ${ok}\n\n## output\n\n${output}\n`)

    console.log(output)
    console.log(`\n로그: ${runnerLogFile}`)

    const briefingFile = join(BRIEFINGS_DIR, `engineer-${today()}.md`)
    if (existsSync(briefingFile)) {
        const briefing = readFileSync(briefingFile, "utf8")
        const userDecisionMatch = briefing.match(/사용자 결정 필요[^\n]*\n([\s\S]*?)(?:\n##|$)/)
        const hasUserDecision = userDecisionMatch && /⚠️|🔴/.test(userDecisionMatch[1])
        if (hasUserDecision) {
            try {
                execSync(`osascript -e 'display notification "Engineer: ⚠️ 사용자 결정 필요 — briefing 확인" with title "🛠 Engineer 주간 보고"'`)
            } catch (_) { /* 알림 실패 무시 */ }
        }
    }

    if (!ok) process.exit(1)
}

main().catch(e => {
    console.error("치명적 오류:", e)
    process.exit(1)
})
