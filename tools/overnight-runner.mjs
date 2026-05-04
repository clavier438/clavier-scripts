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
 * 동작 (STL 원칙 — DECISIONS.md 2026-05-04 ADR):
 *   새벽루틴 (overnight) = 매일 03:00 영역의 단일 책임자, 사용자에 직접 보고.
 *   부하 3명을 임명·감독:
 *     부하 1: police   — 5 영역 헬스 순찰 (precheck all)
 *     부하 2: watchman — 워커 KV 스냅샷 (workerCtl conduct)
 *     부하 3: queue    — OVERNIGHT_QUEUE.md 사용자 박은 명령 실행
 *   통합: overnight-prompt.md (새벽루틴 entity) 가 부하 raw 3개 → 단일 briefing 작성
 *   저장: briefings/overnight-YYYY-MM-DD.md (사용자가 보는 유일한 보고)
 *
 *   info-arch / scribe / Ray = clavier-hq/archive/ 로 이동 (STL 위반 — 무소속).
 *
 * 수동 실행:
 *   node tools/overnight-runner.mjs        # 정상 실행
 *   node tools/overnight-runner.mjs --dry  # dry-run
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { execSync } from "child_process"
import { join } from "path"
import { REPO_ROOT, findClavierHq } from "./lib/repoPaths.mjs"

// claude 바이너리 경로 — env > 알려진 후보 직접 검사 > command -v 자동탐색
// launchd / cron 의 최소 PATH 에서도 안전하도록 알려진 후보를 우선 검사.
const CLAUDE_BIN = (() => {
    if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
    const home = process.env.HOME ?? ""
    // 1순위: 알려진 설치 경로 (Mac launchd / cron 의 최소 PATH 에서도 동작)
    for (const p of [`${home}/.local/bin/claude`, "/usr/local/bin/claude", "/opt/homebrew/bin/claude"]) {
        if (existsSync(p)) return p
    }
    // 2순위: PATH 가 풍부한 환경 (interactive shell, systemd User)
    try {
        const out = execSync("command -v claude", { encoding: "utf8" }).trim()
        if (out) return out
    } catch { /* not found */ }
    return null
})()

// 이 repo 의 root — sibling 관례에 따라 자동 산출
const SCRIPTS_DIR = REPO_ROOT

const HQ = findClavierHq()

if (!HQ) {
    console.error("clavier-hq 경로 못 찾음. CLAVIER_HQ env 또는 sibling 클론 필요.")
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

    // 0. police: 매일 새벽 핵심 영역 순찰 + precheck 해석 (Conductor 와 SRP 분리)
    //    police agent 가 precheck all 실행 + 5 영역 순찰 (workers/repos/actions/framer-sync/OCI)
    //    + 분류 (🟢/🟡/🔴) + 자동 수정 가능한 건 시도 + 결정 필요는 alarm.
    //    police-prompt.md 없으면 precheck.sh 직접 실행 fallback.
    log.push("## 부하 1: police (새벽 헬스 순찰)")
    const policePromptPath = join(HQ, "police-prompt.md")
    let shieldRedDot = false
    if (existsSync(policePromptPath) && CLAUDE_BIN && existsSync(CLAUDE_BIN)) {
        const policeResult = runCmd(
            `cd "${SCRIPTS_DIR}" && "${CLAUDE_BIN}" --dangerously-skip-permissions -p "$(cat '${policePromptPath}')"`,
            300000
        )
        if (!policeResult.ok) { failCount++; shieldRedDot = true }
        log.push(policeResult.ok ? "✅ 순찰 완료" : "🔴 순찰 실패 또는 빨간점 발견")
        log.push("```")
        log.push(policeResult.output)
        log.push("```")
    } else {
        // fallback: precheck.sh 직접 실행 (claude 바이너리 없거나 prompt 없을 때)
        log.push("⚠️ police-prompt.md 또는 claude 바이너리 부재 — precheck.sh 직접 실행")
        const precheckResult = runCmd(`bash "${join(SCRIPTS_DIR, "tools/precheck.sh")}" all`, 60000)
        log.push(precheckResult.ok ? "✅ 모든 환경 OK" : "🔴 빨간점 발견")
        log.push("```")
        log.push(precheckResult.output)
        log.push("```")
        if (!precheckResult.ok) shieldRedDot = true
    }
    log.push("")

    // 부하 2: watchman — workerCtl conduct
    log.push("## 부하 2: watchman (워커 KV 스냅샷)")
    const conductPath = join(SCRIPTS_DIR, "tools/workerCtl.mjs")
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

    // STL 원칙: step 2 (info-arch) / step 3 (scribe) / step 4 (Ray) 폐기.
    // info-arch / notion-mirror / ray prompt 는 archive/ 로 이동됨.
    // 새벽루틴의 부하는 police (부하 1) + watchman (부하 2) + queue (부하 3) 3명만.
    // 통합 briefing 은 마지막에 overnight-prompt.md (새벽루틴 = 사용자 직접 보고 entity) 가 작성.

    } // end claude guard

    // 부하 3: queue — OVERNIGHT_QUEUE.md 사용자 명령 실행 (최대 20개)
    let text = readFileSync(QUEUE_FILE, "utf8")
    const initialTasks = parseQueue(text).tasks
    log.push(`## 부하 3: queue (사용자 박은 명령, ${initialTasks.length}개)`)
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

    // 부하 3명 raw 수집 완료. 통합 → overnight-prompt (새벽루틴) 가 단일 briefing 작성.
    // STL 원칙: 부하는 사용자에 직접 메시지 X. 새벽루틴이 통합 → 사용자 1 보고.
    mkdirSync(BRIEFINGS_DIR, { recursive: true })
    const logFile = join(BRIEFINGS_DIR, `overnight-${today()}.md`)
    const rawCollected = log.join("\n")
    const overnightPromptPath = join(HQ, "overnight-prompt.md")
    let finalBriefing = rawCollected
    if (existsSync(overnightPromptPath) && CLAUDE_BIN && existsSync(CLAUDE_BIN)) {
        const tmpRaw = `/tmp/overnight-raw-${today()}.md`
        if (!DRY) writeFileSync(tmpRaw, `## 부하 raw 결과 (overnight-runner 가 수집)\n\n${rawCollected}\n`)
        const integration = runCmd(
            `"${CLAUDE_BIN}" --dangerously-skip-permissions -p "$(cat '${overnightPromptPath}' '${tmpRaw}')"`,
            300000
        )
        if (integration.ok) {
            finalBriefing = integration.output
        } else {
            finalBriefing = `[overnight-prompt 통합 실패 — raw 그대로 저장]\n\n${rawCollected}\n\n## 통합 실패\n${integration.output}`
            failCount++
        }
    } else {
        finalBriefing = `[overnight-prompt 또는 claude 바이너리 부재 — raw fallback]\n\n${rawCollected}`
    }
    if (!DRY) {
        writeFileSync(logFile, finalBriefing)
    }
    console.log(finalBriefing)
    console.log("")
    console.log(DRY ? "[DRY RUN] 파일 변경 없음" : `로그: ${logFile}`)

    // 실패 있으면 macOS 알림 — morning shield 빨간점은 별도 알림 (사용자 결정 필요)
    if (shieldRedDot && !DRY) {
        try {
            execSync(`osascript -e 'display notification "환경 사전 점검 실패 — 작업 시작 전 ${logFile} 확인" with title "🔴 morning shield"'`)
        } catch (_) { /* 알림 실패는 무시 */ }
    }
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
