#!/usr/bin/env node
/**
 * framer — framer-sync 로컬 Node 디버그 CLI
 *
 * 사용법:
 *   framer                       # 대화형 메뉴
 *   framer status                # 로컬 SQLite 직접 read (서버 안 띄워도 됨)
 *   framer configure [baseId]    # 인터랙티브 설정 (Base ID, Framer URL+Token).
 *                                  Framer URL+Token 은 쌍 — URL 변경 시 Token 도 같이 입력
 *   framer stage1                # Airtable → SQLite 변환
 *   framer push                  # stage1 + ManagedCollection push
 *   framer reset                 # .local/ 통째로 정리 → 처음부터
 *
 *   framer tables                # SQLite 테이블 + 행수
 *   framer rows <collection>     # stage1_cache 의 한 컬렉션 dump
 *   framer state [<key>]         # worker_state 키/값 (key 없으면 목록)
 *   framer sql "<query>"         # raw SQLite query
 *
 *   framer server start          # background daemon 으로 Hono 서버 띄우기
 *   framer server stop
 *   framer server logs [-f]      # tail (-f 면 follow)
 *   framer server status         # 살아있나 / pid / port / health
 *
 *   framer deploy                # Cloudflare 로 배포 (sisoso)
 *
 * 환경변수:
 *   FRAMER_SYNC_DIR    framer-sync repo 경로 (기본: iCloud canonical 경로)
 *   AIRTABLE_BASE_ID   configure 기본 base (기본: appIrjwfcGeVMI9xb sisoso)
 */

import { execSync, spawn } from "child_process"
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"
import { createInterface } from "readline"

// ── 경로 ───────────────────────────────────────────────────────────────
const FRAMER_SYNC_DIR = process.env.FRAMER_SYNC_DIR
    ?? join(homedir(), "Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/platform-workers/framer-sync")
const LOCAL_DIR  = join(FRAMER_SYNC_DIR, ".local")
const DB_PATH    = join(LOCAL_DIR, "framer-sync.db")
const PIDFILE    = join(LOCAL_DIR, "server.pid")
const LOGFILE    = join(LOCAL_DIR, "server.log")
const PORT       = Number(process.env.PORT ?? 8787)
const DEFAULT_BASE = process.env.AIRTABLE_BASE_ID ?? "appIrjwfcGeVMI9xb"

// ── 색상 ───────────────────────────────────────────────────────────────
const c = { reset:"\x1b[0m", bold:"\x1b[1m", dim:"\x1b[2m",
    cyan:"\x1b[36m", green:"\x1b[32m", yellow:"\x1b[33m", red:"\x1b[31m", gray:"\x1b[90m" }
const bold=s=>`${c.bold}${s}${c.reset}`, dim=s=>`${c.dim}${s}${c.reset}`
const cyan=s=>`${c.cyan}${s}${c.reset}`, green=s=>`${c.green}${s}${c.reset}`
const yellow=s=>`${c.yellow}${s}${c.reset}`, red=s=>`${c.red}${s}${c.reset}`
const gray=s=>`${c.gray}${s}${c.reset}`

// ── 공통 헬퍼 ──────────────────────────────────────────────────────────
function dop(args, opts = {}) {
    // doppler run + npx tsx cli.ts <args>
    return execSync(
        `doppler run --project clavier --config prd -- npx tsx src/platform/node/cli.ts ${args}`,
        { cwd: FRAMER_SYNC_DIR, stdio: opts.stdio ?? "inherit", env: { ...process.env, ...opts.env } }
    )
}

function sql(query) {
    if (!existsSync(DB_PATH)) {
        console.log(yellow(`DB 없음: ${DB_PATH}`))
        console.log(dim(`  먼저 'framer configure' 실행`))
        process.exit(1)
    }
    return execSync(`sqlite3 -header -column "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`,
        { encoding: "utf8" })
}

function sqlRaw(query) {
    if (!existsSync(DB_PATH)) return ""
    return execSync(`sqlite3 "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`,
        { encoding: "utf8" }).trim()
}

function pidAlive(pid) {
    try { process.kill(pid, 0); return true } catch { return false }
}

function readPid() {
    if (!existsSync(PIDFILE)) return null
    const pid = Number(readFileSync(PIDFILE, "utf8").trim())
    return pid && pidAlive(pid) ? pid : null
}

// ── 명령들 ─────────────────────────────────────────────────────────────
const commands = {
    status() {
        if (!existsSync(DB_PATH)) {
            console.log(yellow(`DB 없음 (unconfigured)`))
            console.log(dim(`  ${DB_PATH}`))
            console.log(`  → ${cyan("framer configure")} 실행`)
            return
        }
        const cfgRaw = sqlRaw(`SELECT value FROM worker_state WHERE key='config'`)
        if (!cfgRaw) {
            console.log(yellow("config 없음 — 'framer configure' 필요"))
            return
        }
        const cfg = JSON.parse(cfgRaw)
        const sync = JSON.parse(sqlRaw(`SELECT value FROM worker_state WHERE key='sync:status'`) || "null")
        const managed = JSON.parse(sqlRaw(`SELECT value FROM worker_state WHERE key='managed:status'`) || "null")
        const tableCounts = sqlRaw(`SELECT collection || ':' || COUNT(*) FROM stage1_cache GROUP BY collection`).split("\n")

        console.log(bold("framer-sync (local)"))
        console.log(`  ${gray("DB:")}        ${DB_PATH}`)
        console.log(`  ${gray("Airtable:")}  ${cfg.airtableBaseId} ${cfg.airtableToken ? green("✓") : red("✗ no token")}`)
        console.log(`  ${gray("Framer:")}    ${cfg.framer?.projectUrl ?? red("미설정")}`)
        console.log(`  ${gray("tables:")}    ${cfg.tables.length} (${cfg.tables.map(t=>t.collectionName).join(", ")})`)
        console.log(`  ${gray("stage1:")}    ${tableCounts.length ? tableCounts.join("  ") : dim("(empty)")}`)
        console.log(`  ${gray("sync:")}      ${sync?.status ?? dim("none")}  ${sync?.lastStage1 ? dim(sync.lastStage1) : ""}`)
        console.log(`  ${gray("managed:")}   ${managed?.status ?? dim("none")}  ${managed?.finishedAt ? dim(managed.finishedAt) : ""}`)
        const srvPid = readPid()
        console.log(`  ${gray("server:")}    ${srvPid ? green(`running pid=${srvPid} :${PORT}`) : dim("stopped")}`)
    },

    configure(args) {
        // Doppler-only: 모든 설정은 Doppler 에서 읽음. configure 는 schema 캐시 갱신 트리거만.
        // 변경: doppler secrets set FRAMER_CONFIG='{"projectUrl":"...","apiKey":"..."}'
        //       doppler secrets set AIRTABLE_BASE_ID=app...
        const baseIdEnv = process.env.AIRTABLE_BASE_ID
        const baseId = args[0] ?? baseIdEnv ?? DEFAULT_BASE
        if (!process.env.AIRTABLE_API_KEY) {
            console.log(red("✗ AIRTABLE_API_KEY env 없음 — 'doppler run -- framer configure' 형태로 실행"))
            process.exit(1)
        }
        if (!process.env.FRAMER_CONFIG) {
            console.log(yellow("FRAMER_CONFIG env 없음 — Framer 미설정 상태로 진행 (push 불가)"))
        }
        console.log(dim(`AIRTABLE_BASE_ID=${baseId}`))
        dop(`configure`, { env: { AIRTABLE_BASE_ID: baseId } })
    },

    stage1() { dop(`stage1`) },
    push()   { dop(`push-managed`) },
    "push-managed"() { dop(`push-managed`) },

    reset() {
        const srvPid = readPid()
        if (srvPid) {
            console.log(yellow(`server 먼저 정지 (pid=${srvPid})`))
            try { process.kill(srvPid) } catch {}
        }
        if (existsSync(LOCAL_DIR)) {
            rmSync(LOCAL_DIR, { recursive: true, force: true })
            console.log(green(`✓ ${LOCAL_DIR} 삭제`))
        } else {
            console.log(dim("이미 깨끗"))
        }
    },

    tables() {
        // 모든 user 테이블 + 행수
        const names = sqlRaw(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
            .split("\n").filter(Boolean)
        console.log(bold("SQLite tables"))
        for (const t of names) {
            const cnt = sqlRaw(`SELECT COUNT(*) FROM ${t}`)
            console.log(`  ${cyan(t.padEnd(22))} ${gray(cnt + " rows")}`)
        }
        // stage1_cache 컬렉션 별
        if (names.includes("stage1_cache")) {
            console.log()
            console.log(bold("stage1_cache by collection"))
            const out = sqlRaw(`SELECT collection || '|' || COUNT(*) FROM stage1_cache GROUP BY collection ORDER BY collection`)
            for (const line of out.split("\n").filter(Boolean)) {
                const [col, cnt] = line.split("|")
                console.log(`  ${cyan(col.padEnd(22))} ${gray(cnt + " rows")}`)
            }
        }
    },

    rows(args) {
        const col = args[0]
        if (!col) { console.log(red("사용: framer rows <collection>")); process.exit(2) }
        console.log(sql(`SELECT slug, hash, length(fields_json) AS json_bytes FROM stage1_cache WHERE collection='${col}' ORDER BY slug`))
    },

    state(args) {
        const key = args[0]
        if (key) {
            const v = sqlRaw(`SELECT value FROM worker_state WHERE key='${key}'`)
            if (!v) { console.log(yellow(`키 없음: ${key}`)); return }
            try { console.log(JSON.stringify(JSON.parse(v), null, 2)) }
            catch { console.log(v) }
        } else {
            console.log(sql(`SELECT key, length(value) AS bytes, datetime(updated_at,'unixepoch','localtime') AS updated FROM worker_state ORDER BY key`))
        }
    },

    sql(args) {
        const q = args.join(" ")
        if (!q) { console.log(red('사용: framer sql "SELECT ..."')); process.exit(2) }
        console.log(sql(q))
    },

    server(args) {
        const sub = args[0]
        const subs = {
            start() {
                if (readPid()) { console.log(yellow("이미 running")); return }
                if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true })
                const out = openSync(LOGFILE, "a")
                const child = spawn("doppler", ["run", "--project", "clavier", "--config", "prd", "--",
                    "npx", "tsx", "src/platform/node/server.ts"], {
                    cwd: FRAMER_SYNC_DIR,
                    detached: true,
                    stdio: ["ignore", out, out],
                })
                writeFileSync(PIDFILE, String(child.pid))
                child.unref()
                console.log(green(`✓ server started`) + dim(`  pid=${child.pid}  port=${PORT}  log=${LOGFILE}`))
            },
            stop() {
                const pid = readPid()
                if (!pid) { console.log(dim("running 아님")); return }
                try { process.kill(pid); console.log(green(`✓ stopped (pid=${pid})`)) }
                catch (e) { console.log(red(`kill 실패: ${e.message}`)) }
                try { unlinkSync(PIDFILE) } catch {}
            },
            restart() { subs.stop(); setTimeout(() => subs.start(), 500) },
            logs() {
                if (!existsSync(LOGFILE)) { console.log(yellow("log 파일 없음")); return }
                const follow = args.includes("-f")
                const cmd = follow ? `tail -f "${LOGFILE}"` : `tail -50 "${LOGFILE}"`
                execSync(cmd, { stdio: "inherit" })
            },
            status() {
                const pid = readPid()
                console.log(`  ${gray("pid:")}    ${pid ? green(pid) : dim("없음")}`)
                console.log(`  ${gray("port:")}   ${PORT}`)
                console.log(`  ${gray("log:")}    ${LOGFILE}`)
                if (pid) {
                    try {
                        const r = execSync(`curl -s -m 2 http://localhost:${PORT}/status`, { encoding: "utf8" })
                        const d = JSON.parse(r)
                        console.log(`  ${gray("health:")} ${green("✓")} ${dim(`configured=${d.configured} tables=${d.tables.length}`)}`)
                    } catch {
                        console.log(`  ${gray("health:")} ${red("✗ 응답 없음")}`)
                    }
                }
            },
        }
        if (!sub || !subs[sub]) {
            console.log(`사용: framer server <${Object.keys(subs).join("|")}>`)
            return
        }
        subs[sub]()
    },

    deploy(args) {
        const env = args[0] ?? "sisoso"
        execSync(`doppler run --project clavier --config prd -- npm run deploy:${env}`,
            { cwd: FRAMER_SYNC_DIR, stdio: "inherit" })
    },

    help() { showHelp() },
}

function showHelp() {
    console.log(bold("framer") + dim(" — framer-sync 로컬 Node 디버그 CLI"))
    console.log()
    console.log(bold("기본 use case 실행"))
    console.log(`  ${cyan("status")}                  로컬 SQLite 직접 read (서버 X)`)
    console.log(`  ${cyan("configure")} ${dim("[baseId]")}      인터랙티브 설정 (Base ID, Framer URL+Token 쌍)`)
    console.log(`  ${cyan("stage1")}                  Airtable → SQLite 변환`)
    console.log(`  ${cyan("push")}                    stage1 + ManagedCollection push`)
    console.log(`  ${cyan("reset")}                   .local/ 통째 정리`)
    console.log()
    console.log(bold("SQLite inspect"))
    console.log(`  ${cyan("tables")}                  테이블 + 행수`)
    console.log(`  ${cyan("rows")} ${dim("<col>")}              stage1_cache 의 한 컬렉션 dump`)
    console.log(`  ${cyan("state")} ${dim("[<key>]")}           worker_state 키/값`)
    console.log(`  ${cyan("sql")} ${dim('"<query>"')}          raw SQLite query`)
    console.log()
    console.log(bold("server (background daemon)"))
    console.log(`  ${cyan("server start|stop|restart|logs [-f]|status")}`)
    console.log()
    console.log(bold("배포"))
    console.log(`  ${cyan("deploy")} ${dim("[env]")}            Cloudflare 배포 (기본 sisoso)`)
    console.log()
    console.log(dim(`repo: ${FRAMER_SYNC_DIR}`))
}

// ── interactive ────────────────────────────────────────────────────────
async function interactive() {
    const items = [
        ["status",       "로컬 상태 확인"],
        ["configure",    "설정 변경 (Base ID, Framer URL+Token 쌍)"],
        ["stage1",       "Airtable → SQLite 변환"],
        ["push",         "stage1 + ManagedCollection push"],
        ["tables",       "SQLite 테이블 + 행수"],
        ["state",        "worker_state 목록"],
        ["server start", "background 서버 시작"],
        ["server stop",  "background 서버 정지"],
        ["server logs",  "서버 로그 (마지막 50줄)"],
        ["reset",        ".local/ 정리"],
        ["deploy",       "Cloudflare 배포"],
        ["help",         "전체 도움말"],
    ]
    showHelp()
    console.log()
    console.log(bold("실행할 명령:"))
    items.forEach(([cmd, desc], i) => {
        console.log(`  ${bold(String(i+1).padStart(2))}. ${cyan(cmd.padEnd(15))} ${dim(desc)}`)
    })
    console.log()
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ans = await new Promise(r => rl.question(`선택 (1-${items.length}, q=종료): `, r))
    rl.close()
    if (ans.trim().toLowerCase() === "q") return
    const n = parseInt(ans.trim(), 10)
    if (!(n >= 1 && n <= items.length)) { console.log(red("잘못된 선택")); process.exit(2) }
    const [cmdLine] = items[n-1]
    const [cmd, ...rest] = cmdLine.split(" ")
    if (typeof commands[cmd] === "function") await commands[cmd](rest)
}

// ── dispatch ───────────────────────────────────────────────────────────
const cmd = process.argv[2]
const args = process.argv.slice(3)

if (!cmd) {
    interactive().catch(e => { console.error(red(e.message)); process.exit(1) })
} else if (cmd === "--help" || cmd === "-h") {
    showHelp()
} else if (commands[cmd]) {
    Promise.resolve()
        .then(() => commands[cmd](args))
        .catch(e => { console.error(red(`✗ ${e.message}`)); process.exit(1) })
} else {
    console.log(red(`알 수 없는 명령: ${cmd}`))
    showHelp()
    process.exit(2)
}
