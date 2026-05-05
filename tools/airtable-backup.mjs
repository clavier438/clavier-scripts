#!/usr/bin/env node
/**
 * airtable-backup — Airtable 의 claude/env 워크스페이스 base 를
 * 로컬 GDrive 마운트 경로에 JSON dump. GDrive Desktop 이 자동 클라우드 sync.
 *
 * Cloudflare Worker subrequest 한도 없음 — Mac 에서 한 번에 다 처리.
 *
 * 사용:
 *   doppler run --project clavier --config prd -- node ~/bin/airtable-backup
 *   doppler run --project clavier --config prd -- node ~/bin/airtable-backup --full
 *   doppler run --project clavier --config prd -- node ~/bin/airtable-backup --base appXXX
 *   doppler run --project clavier --config prd -- node ~/bin/airtable-backup --base appXXX --table section
 *   doppler run --project clavier --config prd -- node ~/bin/airtable-backup --table section
 *
 * 플래그:
 *   --full              skip 무시하고 강제 재기록 (기본은 변경된 파일만 write)
 *   --base <baseId>     특정 base 만 처리 (workspace 필터 우회)
 *   --table <id|name>   특정 table 만 처리 (--base 와 조합 가능. name 은 정확 일치)
 *
 * 증분 동작:
 *   각 파일 write 전에 디스크 기존 파일과 data 비교 (syncedAt 제외).
 *   동일하면 write skip → 파일 mtime 안 변함 → GDrive Desktop 이 안 올림.
 *
 * 출력 구조:
 *   $GDRIVE_PATH/{ws_label}/{base_id}_{base_name}/_meta.json
 *   $GDRIVE_PATH/{ws_label}/{base_id}_{base_name}/{table_id}_{table_name}.json
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"

// ── CLI 파싱 ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const FORCE_FULL = argv.includes("--full")
function argValue(name) {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null
}
const FILTER_BASE = argValue("--base")
const FILTER_TABLE = argValue("--table")

const GDRIVE_PATH = process.env.GDRIVE_PATH
    ?? "/Users/clavier/Library/CloudStorage/GoogleDrive-hyuk439@gmail.com/내 드라이브/works_gdrive/airtable/sync"

const TARGET_WS = {
    "wsp9s9TITA2bUxIdq": "claude",
    "wsp4NCHBiskbiqbhJ": "env",
}

const PAT = process.env.AIRTABLE_PAT ?? process.env.AIRTABLE_API_KEY
if (!PAT) {
    console.error("✗ AIRTABLE_PAT 또는 AIRTABLE_API_KEY 환경변수 필요 (doppler run 으로 실행)")
    process.exit(1)
}

const COLOR = { reset:"\x1b[0m", green:"\x1b[32m", yellow:"\x1b[33m", red:"\x1b[31m", dim:"\x1b[2m", bold:"\x1b[1m", cyan:"\x1b[36m" }
const c = (col, s) => `${COLOR[col]}${s}${COLOR.reset}`

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

async function main() {
    const t0 = Date.now()
    console.log(c("bold", "\n=== airtable-backup ==="))
    console.log(c("dim", `target: ${GDRIVE_PATH}`))
    if (FORCE_FULL) console.log(c("yellow", "  --full: 모든 파일 강제 재기록"))
    if (FILTER_BASE) console.log(c("cyan", `  --base: ${FILTER_BASE}`))
    if (FILTER_TABLE) console.log(c("cyan", `  --table: ${FILTER_TABLE}`))
    console.log()

    let targets

    if (FILTER_BASE) {
        // 특정 base 직접 조회 (workspace 검증 + meta 가져오기)
        console.log(`1. base ${FILTER_BASE} 직접 조회...`)
        try {
            const ws = await getBaseWs(FILTER_BASE)
            const wsLabel = TARGET_WS[ws] ?? "other"
            // base name 은 listAllBases 에서만 옴 → 별도 조회 불가, base id 로 대체
            targets = [{ id: FILTER_BASE, name: FILTER_BASE, ws, wsLabel, permissionLevel: "?" }]
            // listAllBases 한 번 호출해서 name 채우기 (FILTER_BASE 가 list 에 있으면)
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
    let totalTables = 0, totalRecords = 0, wroteFiles = 0, skippedFiles = 0, errors = []

    for (let i = 0; i < targets.length; i++) {
        const base = targets[i]
        const baseDir = join(GDRIVE_PATH, base.wsLabel, sanitize(`${base.id}_${base.name}`))
        try {
            mkdirSync(baseDir, { recursive: true })
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
    console.log(`  errors:  ${errors.length ? c("red", errors.length) : 0}`)
    console.log(`  소요:    ${dur}s`)
    console.log(`  경로:    ${GDRIVE_PATH}`)
    if (errors.length) {
        console.log()
        for (const e of errors) console.log(c("red", `   ${e.name}: ${e.error.slice(0,100)}`))
    }
}

main().catch(e => { console.error(c("red", `\n✗ ${e.stack || e.message}`)); process.exit(1) })
