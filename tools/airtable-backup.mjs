#!/usr/bin/env node
/**
 * airtable-backup — Airtable 의 claude/env 워크스페이스 모든 base 를
 * 로컬 GDrive 마운트 경로에 JSON dump. GDrive Desktop 이 자동 클라우드 sync.
 *
 * Cloudflare Worker subrequest 한도 없음 — Mac 에서 한 번에 다 처리.
 *
 * 사용:
 *   doppler run --project clavier --config prd -- node ~/bin/airtable-backup
 *
 * 출력 구조:
 *   $GDRIVE_PATH/{ws_label}/{base_id}_{base_name}/_meta.json
 *   $GDRIVE_PATH/{ws_label}/{base_id}_{base_name}/{table_id}_{table_name}.json
 */

import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"

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

const COLOR = { reset:"\x1b[0m", green:"\x1b[32m", yellow:"\x1b[33m", red:"\x1b[31m", dim:"\x1b[2m", bold:"\x1b[1m" }
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

async function main() {
    const t0 = Date.now()
    console.log(c("bold", "\n=== airtable-backup ==="))
    console.log(c("dim", `target: ${GDRIVE_PATH}\n`))

    console.log("1. Airtable bases 목록 가져옴...")
    const allBases = await listAllBases()
    console.log(c("dim", `   총 ${allBases.length} bases\n`))

    console.log("2. 워크스페이스 lookup 후 claude/env 만 필터링 (병렬 8개씩)...")
    const targets = []
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

    console.log("3. 각 base 의 tables × records 가져와서 GDrive 마운트로 dump...")
    let totalTables = 0, totalRecords = 0, errors = []

    for (let i = 0; i < targets.length; i++) {
        const base = targets[i]
        const baseDir = join(GDRIVE_PATH, base.wsLabel, sanitize(`${base.id}_${base.name}`))
        try {
            mkdirSync(baseDir, { recursive: true })
            const tables = await fetchTables(base.id)

            const meta = {
                baseId: base.id,
                baseName: base.name,
                workspaceId: base.ws,
                workspaceLabel: base.wsLabel,
                permissionLevel: base.permissionLevel,
                tables: tables.map(t => ({ id: t.id, name: t.name, fieldCount: (t.fields || []).length })),
                syncedAt: new Date().toISOString(),
            }
            writeFileSync(join(baseDir, "_meta.json"), JSON.stringify(meta, null, 2))

            let baseRecords = 0
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
                writeFileSync(join(baseDir, fileName), JSON.stringify(data, null, 2))
                baseRecords += records.length
            }
            totalTables += tables.length
            totalRecords += baseRecords
            console.log(c("green", `   [${String(i+1).padStart(2)}/${targets.length}]`)
                + ` ${base.wsLabel}/${base.name}` + c("dim", ` — ${tables.length} tables, ${baseRecords} records`))
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
    console.log(`  errors:  ${errors.length ? c("red", errors.length) : 0}`)
    console.log(`  소요:    ${dur}s`)
    console.log(`  경로:    ${GDRIVE_PATH}`)
    if (errors.length) {
        console.log()
        for (const e of errors) console.log(c("red", `   ${e.name}: ${e.error.slice(0,100)}`))
    }
}

main().catch(e => { console.error(c("red", `\n✗ ${e.stack || e.message}`)); process.exit(1) })
