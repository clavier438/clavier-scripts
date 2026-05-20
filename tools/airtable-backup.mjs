#!/usr/bin/env node
/**
 * airtable-backup — Airtable 의 claude/env 워크스페이스 base 를
 * 로컬 GDrive 마운트 경로에 JSON dump. GDrive Desktop 이 자동 클라우드 sync.
 *
 * Cloudflare Worker subrequest 한도 없음 — Mac 에서 한 번에 다 처리.
 *
 * 사용 (doppler 는 자동 wrap — AIRTABLE_PAT 없으면 self-respawn under doppler run):
 *   airtable-backup
 *   airtable-backup --full
 *   airtable-backup --base appXXX
 *   airtable-backup --base 'https://airtable.com/appXXX/tblYYY/viwZZZ'   # URL paste 도 됨
 *   airtable-backup --base appXXX --table section
 *   airtable-backup --table section
 *
 * 플래그:
 *   --full              skip 무시하고 강제 재기록 (기본은 변경된 파일만 write)
 *   --base <id|URL>     특정 base 만 처리. URL 통째 paste 가능 — 정규식으로 base id 추출.
 *   --table <id|name>   특정 table 만 처리 (--base 와 조합 가능. name 은 정확 일치)
 *
 * 증분 동작:
 *   각 파일 write 전에 디스크 기존 파일과 data 비교 (syncedAt 제외).
 *   동일하면 write skip → 파일 mtime 안 변함 → GDrive Desktop 이 안 올림.
 *
 * 출력 구조:
 *   $GDRIVE_PATH/{ws_label}/{base_name}/_meta.json
 *   $GDRIVE_PATH/{ws_label}/{base_name}/{table_id}_{table_name}.json
 *   • 이름 충돌 시 자동 suffix: "{base_name} ({short_id})"
 *   • 구 형식 "{base_id}_{base_name}" 폴더는 첫 run 에서 "{base_name}" 으로 자동 rename
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { spawnSync } from "child_process"

// ── ANSI color ───────────────────────────────────────────────────────────
const COLOR = { reset:"\x1b[0m", green:"\x1b[32m", yellow:"\x1b[33m", red:"\x1b[31m", dim:"\x1b[2m", bold:"\x1b[1m", cyan:"\x1b[36m" }
const c = (col, s) => `${COLOR[col]}${s}${COLOR.reset}`

// ── Doppler auto-wrap ────────────────────────────────────────────────────
// AIRTABLE_PAT 없으면 자동으로 `doppler run --project clavier --config prd --` 으로
// self-respawn. 이미 export 됐거나 한 번 wrap 거친 경우 skip.
if (!process.env.AIRTABLE_PAT && !process.env.AIRTABLE_API_KEY && !process.env._AIRTABLE_BACKUP_WRAPPED) {
    const scriptPath = fileURLToPath(import.meta.url)
    const r = spawnSync(
        "doppler",
        ["run", "--project", "clavier", "--config", "prd", "--", "node", scriptPath, ...process.argv.slice(2)],
        { stdio: "inherit", env: { ...process.env, _AIRTABLE_BACKUP_WRAPPED: "1" } },
    )
    if (r.error) {
        if (r.error.code === "ENOENT") {
            console.error(c("red", "✗ doppler 명령 못 찾음. 설치: brew install dopplerhq/cli/doppler"))
        } else {
            console.error(c("red", `✗ doppler 실행 실패: ${r.error.message}`))
        }
        process.exit(1)
    }
    process.exit(r.status ?? 1)
}

// ── CLI 파싱 ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const FORCE_FULL = argv.includes("--full")
function argValue(name) {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null
}
// Airtable base id = "app" + 14 alphanumeric.
function extractBaseId(input) {
    if (!input) return null
    const m = String(input).match(/app[A-Za-z0-9]{14}/)
    return m ? m[0] : null
}
const FILTER_BASE_RAW = argValue("--base")
const FILTER_BASE = FILTER_BASE_RAW ? extractBaseId(FILTER_BASE_RAW) : null
if (FILTER_BASE_RAW && !FILTER_BASE) {
    console.error(c("red", `✗ --base 값에서 base id 추출 실패: "${FILTER_BASE_RAW}"`))
    console.error(c("dim", "   appXXXXXXXXXXXXXX (17자) 또는 base URL 을 넘기세요"))
    process.exit(1)
}
const FILTER_TABLE = argValue("--table")

// GoogleDrive 마운트 경로는 사용자·계정·Drive 앱 언어에 따라 달라 하드코딩 불가.
// CloudStorage 에서 마운트를 탐색하고, 명시적 override 는 GDRIVE_PATH 로 받는다.
const GDRIVE_SUBPATH = "works_gdrive/airtable/sync"

function resolveGdrivePath() {
    if (process.env.GDRIVE_PATH) return process.env.GDRIVE_PATH

    const die = (msg) => {
        console.error(`✗ ${msg}`)
        process.exit(1)
    }
    const cloudStorage = join(homedir(), "Library", "CloudStorage")
    let entries
    try {
        entries = readdirSync(cloudStorage)
    } catch {
        die(`CloudStorage 폴더 없음 (${cloudStorage}) — Google Drive 데스크톱 앱 설치/실행 확인`)
    }
    const account = entries.find(d => d.startsWith("GoogleDrive-"))
    if (!account) die(`GoogleDrive 마운트 없음 (${cloudStorage}) — Drive 앱 로그인/실행 확인, 또는 GDRIVE_PATH 직접 지정`)

    const accountDir = join(cloudStorage, account)
    // "My Drive" 폴더명은 Drive 앱 언어 설정에 따라 다름 (영문 "My Drive" / 한글 "내 드라이브")
    const myDrive = ["My Drive", "내 드라이브"].find(n => readdirSync(accountDir).includes(n))
    if (!myDrive) die(`'My Drive' 폴더를 ${accountDir} 에서 못 찾음 — GDRIVE_PATH 로 직접 지정`)

    return join(accountDir, myDrive, GDRIVE_SUBPATH)
}

const GDRIVE_PATH = resolveGdrivePath()

const TARGET_WS = {
    "wsp9s9TITA2bUxIdq": "claude",
    "wsp4NCHBiskbiqbhJ": "env",
}

const PAT = process.env.AIRTABLE_PAT ?? process.env.AIRTABLE_API_KEY
if (!PAT) {
    // 도달하면 doppler config 에 AIRTABLE_PAT 자체가 없는 것
    console.error(c("red", "✗ AIRTABLE_PAT 못 받음 — doppler config (project=clavier, config=prd) 에 AIRTABLE_PAT 있는지 확인"))
    process.exit(1)
}

async function airtable(path) {
    const r = await fetch(`https://api.airtable.com${path}`, {
        headers: { Authorization: `Bearer ${PAT}` },
    })
    if (!r.ok) throw new Error(`Airtable ${r.status} ${path}: ${await r.text()}`)
    return r.json()
}

async function listAllBases() {
    const bases = []
    let offset = ""
    do {
        const j = await airtable(`/v0/meta/bases${offset ? `?offset=${offset}` : ""}`)
        bases.push(...(j.bases || []))
        offset = j.offset || ""
    } while (offset)
    return bases
}

async function getBaseWs(baseId) {
    const j = await airtable(`/v0/meta/bases/${baseId}`)
    return j.workspaceId
}

async function fetchTables(baseId) {
    const j = await airtable(`/v0/meta/bases/${baseId}/tables`)
    return j.tables || []
}

async function fetchAllRecords(baseId, tableId) {
    const records = []
    let offset = ""
    do {
        const q = offset ? `?offset=${offset}&pageSize=100` : "?pageSize=100"
        const j = await airtable(`/v0/${baseId}/${tableId}${q}`)
        records.push(...(j.records || []))
        offset = j.offset || ""
    } while (offset)
    return records
}

function sanitize(s) {
    return String(s).replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 100) || "_"
}

function readMetaSafe(metaPath) {
    if (!existsSync(metaPath)) return null
    try { return JSON.parse(readFileSync(metaPath, "utf8")) } catch { return null }
}

// 증분 write — 기존 파일과 data 동일하면 skip (syncedAt 제외 비교).
// return: true=wrote, false=skipped
function writeIfChanged(filePath, data) {
    const newJson = JSON.stringify(data, null, 2)
    if (!FORCE_FULL && existsSync(filePath)) {
        try {
            const oldJson = readFileSync(filePath, "utf8")
            const oldData = JSON.parse(oldJson)
            // syncedAt 제외 비교
            const { syncedAt: _o, ...oldStripped } = oldData
            const { syncedAt: _n, ...newStripped } = data
            if (JSON.stringify(oldStripped) === JSON.stringify(newStripped)) {
                return false  // skip — 내용 동일
            }
        } catch { /* 파싱 실패 → 강제 write */ }
    }
    writeFileSync(filePath, newJson)
    return true
}

// ── 폴더 경로 결정 + 구 형식 마이그레이션 ────────────────────────────────
// 출력 폴더명 = base 이름 그대로 (sanitize 만). 처리 로직:
//  1) wsDir 안 "{base.id}_..." 구 형식 폴더 발견 → "{baseName}" 으로 자동 rename.
//  2) 새 이름이 다른 base 차지 중 → "{baseName} ({shortId})" suffix 사용.
function resolveBaseDir(wsDir, base) {
    const desiredName = sanitize(base.name)
    const desiredPath = join(wsDir, desiredName)
    const shortId = base.id.slice(3, 9)  // "app" 뒤 6자

    let entries = []
    if (existsSync(wsDir)) {
        try { entries = readdirSync(wsDir) } catch { /* ignore */ }
    }

    // 1) 구 형식 폴더 검색 ("{base.id}_..." prefix)
    const oldPrefix = base.id + "_"
    const oldFolder = entries.find(e => e.startsWith(oldPrefix))

    if (oldFolder) {
        const oldPath = join(wsDir, oldFolder)
        if (oldPath === desiredPath) {
            // 이미 새 이름과 동일 — 마이그 X
            return { dir: desiredPath, migrated: null, collided: false }
        }
        if (!existsSync(desiredPath)) {
            renameSync(oldPath, desiredPath)
            return { dir: desiredPath, migrated: { from: oldFolder, to: desiredName }, collided: false }
        }
        // 새 이름 차지 중 → suffix 로 마이그
        const suffixedName = `${desiredName} (${shortId})`
        const suffixedPath = join(wsDir, suffixedName)
        if (!existsSync(suffixedPath)) {
            renameSync(oldPath, suffixedPath)
            return { dir: suffixedPath, migrated: { from: oldFolder, to: suffixedName }, collided: true }
        }
        // suffix 도 차지 — 마이그 포기, 구 폴더 유지 (data loss 방지)
        return { dir: oldPath, migrated: null, collided: false, warning: "구 형식 폴더 유지 (이름·suffix 모두 충돌)" }
    }

    // 2) 구 폴더 없음 → 새 이름 직사용. 단 desiredPath 가 다른 base 차지 중인지 확인.
    if (existsSync(desiredPath)) {
        const meta = readMetaSafe(join(desiredPath, "_meta.json"))
        if (meta && meta.baseId && meta.baseId !== base.id) {
            return { dir: join(wsDir, `${desiredName} (${shortId})`), migrated: null, collided: true }
        }
    }
    return { dir: desiredPath, migrated: null, collided: false }
}

async function main() {
    const t0 = Date.now()
    console.log(c("bold", "\n=== airtable-backup ==="))
    console.log(c("dim", `target: ${GDRIVE_PATH}`))
    if (FORCE_FULL) console.log(c("yellow", "  --full: 모든 파일 강제 재기록"))
    if (FILTER_BASE) {
        const note = FILTER_BASE_RAW !== FILTER_BASE ? c("dim", ` (입력: ${FILTER_BASE_RAW.slice(0, 60)}${FILTER_BASE_RAW.length > 60 ? "…" : ""})`) : ""
        console.log(c("cyan", `  --base: ${FILTER_BASE}`) + note)
    }
    if (FILTER_TABLE) console.log(c("cyan", `  --table: ${FILTER_TABLE}`))
    console.log()

    let targets

    if (FILTER_BASE) {
        console.log(`1. base ${FILTER_BASE} 직접 조회...`)
        try {
            const ws = await getBaseWs(FILTER_BASE)
            const wsLabel = TARGET_WS[ws] ?? "other"
            targets = [{ id: FILTER_BASE, name: FILTER_BASE, ws, wsLabel, permissionLevel: "?" }]
            try {
                const all = await listAllBases()
                const found = all.find(b => b.id === FILTER_BASE)
                if (found) targets[0] = { ...found, ws, wsLabel }
            } catch { /* best-effort */ }
            console.log(c("dim", `   ${wsLabel}/${targets[0].name}\n`))
        } catch (e) {
            console.error(c("red", `✗ base 조회 실패: ${e.message}`))
            process.exit(1)
        }
    } else {
        console.log("1. Airtable bases 목록 가져옴...")
        const allBases = await listAllBases()
        console.log(c("dim", `   총 ${allBases.length} bases\n`))

        console.log("2. 워크스페이스 lookup 후 claude/env 만 필터링 (병렬 8개씩)...")
        targets = []
        const CONCURRENCY = 8
        for (let i = 0; i < allBases.length; i += CONCURRENCY) {
            const batch = allBases.slice(i, i + CONCURRENCY)
            const results = await Promise.all(batch.map(async b => {
                const ws = await getBaseWs(b.id).catch(() => null)
                return { ...b, ws }
            }))
            for (const r of results) {
                if (r.ws && TARGET_WS[r.ws]) {
                    targets.push({ ...r, wsLabel: TARGET_WS[r.ws] })
                }
            }
            process.stdout.write(`\r   ${Math.min(i + CONCURRENCY, allBases.length)}/${allBases.length} 처리`)
        }
        console.log("\n")
        console.log(c("dim", `   타겟: ${targets.length} bases (${targets.filter(b=>b.wsLabel==="claude").length} claude + ${targets.filter(b=>b.wsLabel==="env").length} env)\n`))
    }

    console.log("3. 각 base 의 tables × records 가져와서 GDrive 마운트로 dump...")
    let totalTables = 0, totalRecords = 0, wroteFiles = 0, skippedFiles = 0, migrateCount = 0
    const errors = []

    for (let i = 0; i < targets.length; i++) {
        const base = targets[i]
        const wsDir = join(GDRIVE_PATH, base.wsLabel)
        try {
            mkdirSync(wsDir, { recursive: true })
            const resolved = resolveBaseDir(wsDir, base)
            const baseDir = resolved.dir
            mkdirSync(baseDir, { recursive: true })

            if (resolved.migrated) {
                migrateCount++
                console.log(c("cyan", `   ↪ migrate: ${base.wsLabel}/${resolved.migrated.from} → ${resolved.migrated.to}`))
            }
            if (resolved.collided) {
                console.log(c("yellow", `   ! ${base.wsLabel}/${base.name} — 이름 충돌, suffix: ${baseDir.split("/").pop()}`))
            }
            if (resolved.warning) {
                console.log(c("yellow", `   ! ${base.wsLabel}/${base.name} — ${resolved.warning}`))
            }

            const allTables = await fetchTables(base.id)

            // --table 필터: id 정확 일치 또는 name 정확 일치
            const tables = FILTER_TABLE
                ? allTables.filter(t => t.id === FILTER_TABLE || t.name === FILTER_TABLE)
                : allTables

            if (FILTER_TABLE && tables.length === 0) {
                console.log(c("yellow", `   [${String(i+1).padStart(2)}/${targets.length}] ${base.wsLabel}/${base.name} — table "${FILTER_TABLE}" 없음, skip`))
                continue
            }

            const meta = {
                baseId: base.id,
                baseName: base.name,
                workspaceId: base.ws,
                workspaceLabel: base.wsLabel,
                permissionLevel: base.permissionLevel,
                tables: allTables.map(t => ({ id: t.id, name: t.name, fieldCount: (t.fields || []).length })),
                syncedAt: new Date().toISOString(),
            }
            // _meta.json 은 --table 필터 시엔 건드리지 않음 (full base 정보가 아니라서)
            let metaWrote = false
            if (!FILTER_TABLE) {
                metaWrote = writeIfChanged(join(baseDir, "_meta.json"), meta)
                if (metaWrote) wroteFiles++; else skippedFiles++
            }

            let baseRecords = 0, baseTablesWrote = 0, baseTablesSkipped = 0
            for (const table of tables) {
                const records = await fetchAllRecords(base.id, table.id)
                const data = {
                    baseId: base.id,
                    tableId: table.id,
                    tableName: table.name,
                    primaryFieldId: table.primaryFieldId,
                    fields: table.fields,
                    records,
                    syncedAt: new Date().toISOString(),
                }
                const fileName = sanitize(`${table.id}_${table.name}`) + ".json"
                const wrote = writeIfChanged(join(baseDir, fileName), data)
                if (wrote) { wroteFiles++; baseTablesWrote++ } else { skippedFiles++; baseTablesSkipped++ }
                baseRecords += records.length
            }
            totalTables += tables.length
            totalRecords += baseRecords
            const tablesNote = baseTablesWrote === 0 && !metaWrote
                ? c("dim", `— ${tables.length} tables, ${baseRecords} records (변경 없음)`)
                : c("dim", `— ${tables.length} tables (${c("green", `${baseTablesWrote} 변경`)}${baseTablesSkipped ? `, ${baseTablesSkipped} 동일` : ""}), ${baseRecords} records`)
            console.log(c("green", `   [${String(i+1).padStart(2)}/${targets.length}]`)
                + ` ${base.wsLabel}/${base.name} ` + tablesNote)
        } catch (e) {
            errors.push({ base: base.id, name: base.name, error: String(e) })
            console.log(c("red", `   [${String(i+1).padStart(2)}/${targets.length}] ${base.wsLabel}/${base.name} — ✗ ${String(e).slice(0,80)}`))
        }
    }

    const dur = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(c("bold", `\n=== 완료 ===`))
    console.log(`  bases:   ${c("green", targets.length - errors.length)}/${targets.length}`)
    console.log(`  tables:  ${totalTables}`)
    console.log(`  records: ${totalRecords.toLocaleString()}`)
    console.log(`  write:   ${c("green", wroteFiles)} 변경 / ${c("dim", skippedFiles)} 동일 (skip)`)
    if (migrateCount) console.log(`  migrate: ${c("cyan", migrateCount)} 폴더 rename (구 형식 → baseName)`)
    console.log(`  errors:  ${errors.length ? c("red", errors.length) : 0}`)
    console.log(`  소요:    ${dur}s`)
    console.log(`  경로:    ${GDRIVE_PATH}`)
    if (errors.length) {
        console.log()
        for (const e of errors) console.log(c("red", `   ${e.name}: ${e.error.slice(0,100)}`))
    }
}

main().catch(e => { console.error(c("red", `\n✗ ${e.stack || e.message}`)); process.exit(1) })
