#!/usr/bin/env node
/**
 * overnight-runner — 새벽 큐 처리기 (LaunchAgent가 매일 03:00 실행)
 *
 * 동작:
 *   1. 항상: `worker-ctl conduct` 실행 (모든 워커 스냅샷 + WORKER_STATUS.md 갱신)
 *   2. clavier-hq/OVERNIGHT_QUEUE.md 의 "대기 중" 섹션 파싱
 *      - 미체크 `- [ ]` 항목 + 바로 아래 ```sh 코드블럭 → 그 명령 실행
 *      - 성공 시: `- [ ]` → `- [x]` + "완료" 섹션으로 이동
 *      - 실패 시: 체크 안 함 + 로그에 에러 기록
 *   3. 결과 로그: clavier-hq/briefings/overnight-YYYY-MM-DD.md
 *   4. 7일 지난 "완료" 항목은 큐 파일에서 자동 제거
 *
 * 수동 실행:
 *   node tools/overnight-runner.mjs        # 정상 실행
 *   node tools/overnight-runner.mjs --dry  # 실제 실행 안 하고 무엇이 실행될지만 보기
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { execSync } from "child_process"
import { join } from "path"

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
    // "## 대기 중" 섹션과 "## 완료" 섹션 위치 찾기
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

    // 대기 중 섹션에서 미체크 작업 추출
    const tasks = []
    for (let i = pendingStart + 1; i < pendingEnd; i++) {
        const m = lines[i].match(/^-\s*\[\s*\]\s*(.+)$/)
        if (!m) continue
        const desc = m[1].trim()
        // 다음 ```sh 코드블럭 찾기 (다음 미체크 항목 전까지)
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
    // 7일 이상 지난 "완료" 섹션 항목 제거 (날짜 시작하는 - [x] YYYY-MM-DD 형태 가정)
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000)
    return text.split("\n").filter(line => {
        const m = line.match(/^-\s*\[x\]\s*(\d{4}-\d{2}-\d{2})/)
        if (!m) return true
        return new Date(m[1]) >= cutoff
    }).join("\n")
}

function moveTaskToDone(text, task) {
    const lines = text.split("\n")
    // 미체크 항목 라인 → ✅ + 날짜 표시
    const newDoneLine = `- [x] ${today()} ${task.desc}`

    // 대기 섹션에서 항목 + 코드블럭 제거 (lineIdx부터 다음 미체크 또는 섹션 끝까지)
    let removeEnd = task.lineIdx + 1
    while (removeEnd < lines.length) {
        if (/^-\s*\[/.test(lines[removeEnd])) break
        if (/^##/.test(lines[removeEnd])) break
        if (/^---\s*$/.test(lines[removeEnd])) break
        removeEnd++
    }
    // 마지막 ``` 다음 빈 줄까지 (잘 잡혔는지 검증 후)
    const removed = lines.slice(task.lineIdx, removeEnd).join("\n")
    if (!removed.includes("```")) {
        // 코드블럭 못 찾음 — 라인 1개만 제거
        removeEnd = task.lineIdx + 1
    }

    const before = lines.slice(0, task.lineIdx)
    const after = lines.slice(removeEnd)

    // "## 완료" 섹션에 새 라인 prepend (헤더 + comment 라인 다음)
    const doneIdx = after.findIndex(l => /^##\s+완료/.test(l))
    if (doneIdx === -1) {
        // 완료 섹션 없으면 추가
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
    log.push(`# Overnight Run — ${new Date().toISOString()}`)
    log.push("")

    // 1. 항상 실행: worker-ctl conduct
    log.push("## 1. 영구 작업: worker-ctl conduct")
    const conductPath = join(process.env.HOME ?? "", "Library/Mobile Documents/com~apple~CloudDocs/0/scripts/tools/worker-ctl.mjs")
    const conductResult = runCmd(`node "${conductPath}" conduct`)
    log.push(conductResult.ok ? "✅ 성공" : "❌ 실패")
    log.push("```")
    log.push(conductResult.output)
    log.push("```")
    log.push("")

    // 2. 항상 실행: info-arch (Notion 정보 아키텍처 점검)
    log.push("## 2. 영구 작업: info-arch (Notion 정보 아키텍처)")
    const infoArchPromptPath = join(HQ, "info-arch-prompt.md")
    if (existsSync(infoArchPromptPath)) {
        const infoArchResult = runCmd(
            `claude --dangerously-skip-permissions -p "$(cat '${infoArchPromptPath}')"`,
            300000  // 5분 타임아웃 (AI 실행이라 오래 걸릴 수 있음)
        )
        log.push(infoArchResult.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(infoArchResult.output)
        log.push("```")
    } else {
        log.push("⚠️ info-arch-prompt.md 없음 — 건너뜀")
    }
    log.push("")

    // 2.5 영구 작업: notion-mirror-arch (DECISIONS/CONCEPTS → Notion Architecture Archive)
    log.push("## 2.5 영구 작업: notion-mirror-arch (아키텍처 기록 자동 미러)")
    const notionMirrorPromptPath = join(HQ, "notion-mirror-prompt.md")
    if (existsSync(notionMirrorPromptPath)) {
        const notionMirrorResult = runCmd(
            `claude --dangerously-skip-permissions -p "$(cat '${notionMirrorPromptPath}')"`,
            600000  // 10분 타임아웃 (페이지 다수 생성 가능)
        )
        log.push(notionMirrorResult.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(notionMirrorResult.output)
        log.push("```")
    } else {
        log.push("⚠️ notion-mirror-prompt.md 없음 — 건너뜀")
    }
    log.push("")

    // 2.6 영구 작업: efficiency-minister (직전 24h 작업 효율 감사)
    log.push("## 2.6 영구 작업: efficiency-minister (작업 효율 감사)")
    const efficiencyPromptPath = join(HQ, "efficiency-minister-prompt.md")
    if (existsSync(efficiencyPromptPath)) {
        const efficiencyResult = runCmd(
            `claude --dangerously-skip-permissions -p "$(cat '${efficiencyPromptPath}')"`,
            300000  // 5분 타임아웃
        )
        log.push(efficiencyResult.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(efficiencyResult.output)
        log.push("```")
    } else {
        log.push("⚠️ efficiency-minister-prompt.md 없음 — 건너뜀")
    }
    log.push("")

    // 2.7 영구 작업: researcher (브랜드/비즈니스 리서처 — stayClients DB 미완료 1건/일)
    log.push("## 2.7 영구 작업: researcher (브랜드/비즈니스 리서치)")
    const researcherPromptPath = join(HQ, "researcher-prompt.md")
    if (existsSync(researcherPromptPath)) {
        const researcherResult = runCmd(
            `claude --dangerously-skip-permissions -p "$(cat '${researcherPromptPath}')"`,
            900000  // 15분 타임아웃 (웹 리서치 + 보고서 작성)
        )
        log.push(researcherResult.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(researcherResult.output)
        log.push("```")
    } else {
        log.push("⚠️ researcher-prompt.md 없음 — 건너뜀")
    }
    log.push("")

    // 3. 월요일 전용: Conductor 주간 감사
    const dayOfWeek = new Date().getDay() // 0=일, 1=월
    log.push("## 3. 월요일 전용: Conductor 주간 감사")
    if (dayOfWeek === 1) {
        const conductorPromptPath = join(HQ, "conductor-prompt.md")
        if (existsSync(conductorPromptPath)) {
            const conductorResult = runCmd(
                `claude --dangerously-skip-permissions -p "$(cat '${conductorPromptPath}')"`,
                600000  // 10분 타임아웃 (감사 + 파일 수정 + git push까지)
            )
            log.push(conductorResult.ok ? "✅ 성공" : "❌ 실패")
            log.push("```")
            log.push(conductorResult.output)
            log.push("```")
        } else {
            log.push("⚠️ conductor-prompt.md 없음 — 건너뜀")
        }
    } else {
        log.push("_오늘은 월요일이 아님 — 건너뜀_")
    }
    log.push("")

    // 4. 큐 작업 — 매번 re-parse (line idx 무효화 방지). 최대 20개.
    let text = readFileSync(QUEUE_FILE, "utf8")
    const initialTasks = parseQueue(text).tasks
    log.push(`## 4. 큐 작업 (${initialTasks.length}개)`)
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
        const r = runCmd(next.cmd, 900000)  // 15분 — claude -p 서브 에이전트가 오래 걸림
        log.push(r.ok ? "✅ 성공" : "❌ 실패")
        log.push("```")
        log.push(r.output)
        log.push("```")
        log.push("")

        if (r.ok && !DRY) {
            text = moveTaskToDone(text, next)
        } else {
            failedDescs.add(next.desc)  // 실패한 항목은 큐에 그대로 두되 다시 시도 안 함
        }
    }

    // 5. 오래된 완료 항목 정리
    text = pruneOldDone(text)

    if (!DRY) {
        writeFileSync(QUEUE_FILE, text)
    }

    // 4. 로그 저장
    mkdirSync(BRIEFINGS_DIR, { recursive: true })
    const logFile = join(BRIEFINGS_DIR, `overnight-${today()}.md`)
    if (!DRY) {
        writeFileSync(logFile, log.join("\n"))
    }
    console.log(log.join("\n"))
    console.log("")
    console.log(DRY ? "[DRY RUN] 파일 변경 없음" : `로그: ${logFile}`)
}

main().catch(e => {
    console.error("치명적 오류:", e)
    process.exit(1)
})
