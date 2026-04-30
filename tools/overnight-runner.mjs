#!/usr/bin/env node
/**
 * 비서 (overnight-runner) — 매일 새벽 03:00 기계적 처리
 *
 * 역할: 각 전문가 에이전트를 순서대로 호출하고, OVERNIGHT_QUEUE.md 실행.
 *       직접 결정하지 않고, 각 전문가가 자기 영역에 직접 씁니다.
 *
 * 에이전트 체계:
 *   비서 (여기)       매일 03:00  — watchman + 전문가들 호출 + queue 처리
 *   architect         매주 월요일 — 클린아키텍처 주간 감사 (scheduled task)
 *   strategist        매일 08:00  — 브랜드/비즈니스 전략 + researcher (scheduled task)
 *
 * 동작:
 *   1. watchman: worker-ctl conduct (워커 상태 스냅샷)
 *   2. info-arch: Notion IA 점검 + 모바일 큐 이식
 *   3. scribe: DECISIONS/CONCEPTS → Notion 아카이브 미러
 *   4. auditor: 직전 24h 작업 효율 감사
 *   5. queue: OVERNIGHT_QUEUE.md 미체크 항목 실행
 *   6. 로그 저장: briefings/overnight-YYYY-MM-DD.md
 *
 * 수동 실행:
 *   node tools/overnight-runner.mjs        # 정상 실행
 *   node tools/overnight-runner.mjs --dry  # dry-run
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { execSync } from "child_process"
import { join } from "path"

// alias 의존 금지 — zsh 환경 없는 /bin/sh에서 claude를 직접 경로로 호출
const CLAUDE_BIN = "/Users/clavier/.local/bin/claude"
const SCRIPTS_DIR = "/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/scripts"

const HQ = (() => {
    const candidates = [
        join(process.env.HOME ?? "", "Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/clavier-hq"),
    ]
    return candidates.find(p => existsSync(p))
})()

if (!HQ) {
    console.error("clavier-hq 경로 못 찾음. 종료.")
    process.exit(1)
}

const QUEUE_FILE = join(HQ, "OVERNIGHT_QUEUE.md")
const BRIEFINGS_DIR = join(HQ, "briefings")
const DRY = process.argv.includes("--dry")

function today() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function parseQueue(text) {
    const lines = text.split("\n")
    let pendingStart = -1, pendingEnd = -1, doneStart = -1
    for (let i = 0; i < lines.length; i++) {
        if (/^##\s+대기 중/.test(lines[i])) pendingStart = i
        else if (/^##\s+완료/.test(lines[i])) {
            if (pendingStart !== -1 && pendingEnd === -1) pendingEnd = i
            doneStart = i
        }
    }
    if (pendingStart === -1) return { tasks: [], lines, pendingStart: -1, pendingEnd: -1, doneStart }
    if (pendingEnd === -1) pendingEnd = lines.length

    const tasks = []
    for (let i = pendingStart + 1; i < pendingEnd; i++) {
        const m = lines[i].match(/^-\s*\[\s*\]\s*(.+)$/)
        if (!m) continue
        const desc = m[1].trim()
        let cmd = null, cmdStart = -1, cmdEnd = -1
        for (let j = i + 1; j < pendingEnd; j++) {
            if (/^-\s*\[/.test(lines[j])) break
            if (/^\s*```(sh|bash|shell)?\s*$/.test(lines[j]) && cmdStart === -1) {
                cmdStart = j
                continue
            }
            if (cmdStart !== -1 && /^\s*```\s*$/.test(lines[j])) {
                cmdEnd = j
                cmd = lines.slice(cmdStart + 1, j).join("\n").trim()
                break
            }
        }
        if (cmd) tasks.push({ desc, cmd, lineIdx: i })
    }
    return { tasks, lines, pendingStart, pendingEnd, doneStart }
}

function runCmd(cmd, timeoutMs = 120000) {
    if (DRY) {
        return { ok: true, output: "(dry-run, not executed)" }
    }
    try {
        const output = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs })
        return { ok: true, output: output.slice(0, 2000) }
    } catch (e) {
        return { ok: false, output: (e.stdout ?? "") + (e.stderr ?? "") + "\n" + e.message }
    }
}

function pruneOldDone(text) {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000)
    return text.split("\n").filter(line => {
        const m = line.match(/^-\s*\[x\]\s*(\d{4}-\d{2}-\d{2})/)
        if (!m) return true
        return new Date(m[1]) >= cutoff
    }).join("\n")
}

function moveTaskToDone(text, task) {
    const lines = text.split("\n")
    const newDoneLine = `- [x] ${today()} ${task.desc}`

    let removeEnd = task.lineIdx + 1
    while (removeEnd < lines.length) {
        if (/^-\s*\[/.test(lines[removeEnd])) break
        if (/^##/.test(lines[removeEnd])) break
        if (/^---\s*$/.test(lines[removeEnd])) break
        removeEnd++
    }
    const removed = lines.slice(task.lineIdx, removeEnd).join("\n")
    if (!removed.includes("```")) {
        removeEnd = task.lineIdx + 1
    }

    const before = lines.slice(0, task.lineIdx)
    const after = lines.slice(removeEnd)

    const doneIdx = after.findIndex(l => /^##\s+완료/.test(l))
    if (doneIdx === -1) {
        return [...before, ...after, "", "## 완료", "", newDoneLine].join("\n")
    }
    let insertAt = doneIdx + 1
    while (insertAt < after.length && (after[insertAt].trim() === "" || after[insertAt].startsWith("<!--"))) insertAt++
    const newAfter = [...after.slice(0, insertAt), newDoneLine, ...after.slice(insertAt)]
    return [...before, ...newAfter].join("\n")
}

async function main() {
    if (!existsSync(QUEUE_FILE)) {
        console.error(`큐 파일 없음: ${QUEUE_FILE}`)
        process.exit(1)
    }

    const log = []
    log.push(`# 비서 야간 처리 — ${new Date().toISOString()}`)
    log.push("")

    // 1. watchman: workerCtl conduct
    log.push("## 1. watchman: workerCtl conduct")
    const conductPath = join(process.env.HOME ?? "", "Library/Mobile Documents/com~apple~CloudDocs/0/scripts/tools/workerCtl.mjs")
    const watchmanResult = runCmd(`node "${conductPath}" conduct`)
    log.push(watchmanResult.ok ? "✅ 성공" : "❌ 실패")
    log.push("```")
    log.push(watchmanResult.output)
    log.push("```")
    log.push("")

    let failCount = 0

    // claude 바이너리 존재 확인 — 없으면 즉시 중단
    if (!existsSync(CLAUDE_BIN)) {
        log.push(`❌ claude 바이너리 없음: ${CLAUDE_BIN}`)
        log.push("overnight 전체 중단 — claude 경로 확인 필요")
        failCount++
    } else {

    // 2. info-arch: Notion IA 점검 + 모바일 큐 이식
    log.push("## 2. info-arch: Notion IA 점검")
    const infoArchPromptPath = join(HQ, "info-arch-prompt.md")
    if (existsSync(infoArchPromptPath)) {
        const infoArchResult = runCmd(
            `cd "${SCRIPTS_DIR}" && "${CLAUDE_BIN}" --dangerously-skip-permissions -p "$(cat '${infoArchPromptPath}')"`,
            300000
        )
        if (!infoArchResult.ok) failCount++
        log.push(infoArchResult.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(infoArchResult.output)
        log.push("```")
    } else {
        log.push("⚠️ info-arch-prompt.md 없음 — 건너뜀")
    }
    log.push("")

    // 3. scribe: DECISIONS/CONCEPTS → Notion 아카이브 미러
    log.push("## 3. scribe: Notion 아키텍처 미러")
    const notionMirrorPromptPath = join(HQ, "notion-mirror-prompt.md")
    if (existsSync(notionMirrorPromptPath)) {
        const scribeResult = runCmd(
            `cd "${SCRIPTS_DIR}" && "${CLAUDE_BIN}" --dangerously-skip-permissions -p "$(cat '${notionMirrorPromptPath}')"`,
            600000
        )
        if (!scribeResult.ok) failCount++
        log.push(scribeResult.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(scribeResult.output)
        log.push("```")
    } else {
        log.push("⚠️ notion-mirror-prompt.md 없음 — 건너뜀")
    }
    log.push("")

    // 4. Ray: Pain Button 감사 (Ray Dalio)
    log.push("## 4. Ray: Pain 감사")
    const rayPromptPath = join(HQ, "ray-prompt.md")
    if (existsSync(rayPromptPath)) {
        const rayResult = runCmd(
            `cd "${SCRIPTS_DIR}" && "${CLAUDE_BIN}" --dangerously-skip-permissions -p "$(cat '${rayPromptPath}')"`,
            300000
        )
        if (!rayResult.ok) failCount++
        log.push(rayResult.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(rayResult.output)
        log.push("```")
    } else {
        log.push("⚠️ ray-prompt.md 없음 — 건너뜀")
    }
    log.push("")

    } // end claude guard

    // 5. queue: OVERNIGHT_QUEUE.md 처리 (최대 20개)
    let text = readFileSync(QUEUE_FILE, "utf8")
    const initialTasks = parseQueue(text).tasks
    log.push(`## 5. queue: 대기 작업 (${initialTasks.length}개)`)
    log.push("")

    if (initialTasks.length === 0) {
        log.push("_대기 작업 없음_")
    }

    const failedDescs = new Set()
    let safetyCount = 0
    while (safetyCount++ < 20) {
        const { tasks } = parseQueue(text)
        const next = tasks.find(t => !failedDescs.has(t.desc))
        if (!next) break

        log.push(`### ${next.desc}`)
        log.push("```sh")
        log.push(next.cmd)
        log.push("```")
        const r = runCmd(next.cmd, 900000)
        log.push(r.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(r.output)
        log.push("```")
        log.push("")

        if (r.ok && !DRY) {
            text = moveTaskToDone(text, next)
        } else {
            failedDescs.add(next.desc)
        }
    }

    // 오래된 완료 항목 정리
    text = pruneOldDone(text)

    if (!DRY) {
        writeFileSync(QUEUE_FILE, text)
    }

    // 로그 저장
    mkdirSync(BRIEFINGS_DIR, { recursive: true })
    const logFile = join(BRIEFINGS_DIR, `overnight-${today()}.md`)
    if (!DRY) {
        writeFileSync(logFile, log.join("\n"))
    }
    console.log(log.join("\n"))
    console.log("")
    console.log(DRY ? "[DRY RUN] 파일 변경 없음" : `로그: ${logFile}`)

    // 실패 있으면 macOS 알림
    if (failCount > 0 && !DRY) {
        try {
            execSync(`osascript -e 'display notification "overnight ${failCount}개 실패 — briefings 확인" with title "⚠️ 비서 야간 처리"'`)
        } catch (_) { /* 알림 실패는 무시 */ }
    }
}

main().catch(e => {
    console.error("치명적 오류:", e)
    process.exit(1)
})
