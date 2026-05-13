#!/usr/bin/env node
/**
 * airtable-webhook-register — Airtable Webhooks API CRUD CLI
 *
 * 워커 본체(framer-sync) 에 `POST /airtable-webhook` 라우트가 떠 있다는 전제 하에,
 * Airtable Webhooks API 측 라이프사이클(등록/조회/삭제/갱신/payload peek)을 처리.
 *
 * 사용:
 *   doppler run --project clavier --config prd -- node tools/airtable-webhook-register.mjs <cmd> [flags]
 *
 *   register --base <id> --url <workerUrl> [--table <tblId>] [--fields fld1,fld2] [--data-types tableData,tableFields]
 *     → POST /v0/bases/{base}/webhooks
 *     → 응답의 macSecretBase64 출력. 사용자가 Doppler 에 즉시 저장.
 *
 *   list --base <id>
 *     → GET /v0/bases/{base}/webhooks (등록된 webhook 목록)
 *
 *   delete --base <id> --id <whId>
 *     → DELETE /v0/bases/{base}/webhooks/{whId}
 *
 *   refresh --base <id> --id <whId>
 *     → POST /v0/bases/{base}/webhooks/{whId}/refresh  (expirationTime +7d)
 *
 *   payloads --base <id> --id <whId> [--cursor N] [--limit 50]
 *     → GET /v0/bases/{base}/webhooks/{whId}/payloads — 워커가 보게 될 diff 미리 보기 (debug)
 *
 * 환경변수 (Doppler 주입):
 *   AIRTABLE_PAT                  scope: webhook:manage + data.records:read + schema.bases:read
 *
 * 종료코드: 0 정상, 1 사용자 입력 오류, 2 Airtable API 오류
 */

const argv = process.argv.slice(2)
const CMD = argv[0]
const PAT = process.env.AIRTABLE_PAT ?? process.env.AIRTABLE_API_KEY

function arg(name) {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null
}
function flag(name) { return argv.includes(name) }

const c = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
}
const paint = (col, s) => `${c[col]}${s}${c.reset}`

if (!CMD || CMD === "--help" || CMD === "-h") {
    console.log(`사용법: airtable-webhook-register <register|list|delete|refresh|payloads> [flags]

  register --base <id> --url <https://...> [--table <tblId>] [--fields fld1,fld2]
           [--data-types tableData[,tableFields,tableMetadata]] [--include-values all]
  list     --base <id>
  delete   --base <id> --id <whId>
  refresh  --base <id> --id <whId>
  payloads --base <id> --id <whId> [--cursor N] [--limit 50]

환경: AIRTABLE_PAT (scope: webhook:manage + data.records:read + schema.bases:read)`)
    process.exit(0)
}

if (!PAT) {
    console.error(paint("red", "✗ AIRTABLE_PAT 미설정 — `doppler run ... -- node $0` 으로 실행"))
    process.exit(1)
}

async function airtable(method, path, body) {
    const r = await fetch(`https://api.airtable.com${path}`, {
        method,
        headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    })
    const text = await r.text()
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch { /* keep raw */ }
    if (!r.ok) {
        console.error(paint("red", `✗ ${method} ${path} → ${r.status}`))
        console.error(paint("dim", text))
        process.exit(2)
    }
    return parsed
}

function need(name) {
    const v = arg(name)
    if (!v) { console.error(paint("red", `✗ --${name} 필수`)); process.exit(1) }
    return v
}

// ── commands ──────────────────────────────────────────────────────────

async function cmdRegister() {
    const base = need("--base")
    const url = need("--url")
    const tableId = arg("--table")
    const fieldIds = arg("--fields")?.split(",").map(s => s.trim()).filter(Boolean) ?? null
    const dataTypes = (arg("--data-types") ?? "tableData").split(",").map(s => s.trim())
    const includeValues = arg("--include-values") ?? "all"

    const filters = { dataTypes }
    if (tableId) filters.recordChangeScope = tableId
    if (fieldIds) filters.watchDataInFieldIds = fieldIds

    const body = {
        notificationUrl: url,
        specification: {
            options: {
                filters,
                includes: { includeCellValuesInFieldIds: includeValues },
            },
        },
    }

    const res = await airtable("POST", `/v0/bases/${base}/webhooks`, body)
    console.log(paint("green", "✓ 등록 완료"))
    console.log(`  id              ${paint("bold", res.id)}`)
    console.log(`  expirationTime  ${res.expirationTime ?? "(없음 - User API key)"}`)
    console.log(paint("yellow", "\n★ macSecretBase64 (★ 한 번만 응답옴 — 즉시 Doppler 저장):"))
    console.log(`  ${paint("bold", res.macSecretBase64)}`)
    console.log(paint("dim", `\n다음 단계:`))
    console.log(paint("dim", `  doppler secrets set AIRTABLE_WEBHOOK_MAC_SECRET_${base}=${res.macSecretBase64}`))
    console.log(paint("dim", `  doppler secrets set AIRTABLE_WEBHOOK_ID_${base}=${res.id}`))
}

async function cmdList() {
    const base = need("--base")
    const res = await airtable("GET", `/v0/bases/${base}/webhooks`)
    const list = res.webhooks ?? []
    if (list.length === 0) { console.log(paint("dim", "(없음)")); return }
    for (const w of list) {
        console.log(`${paint("bold", w.id)}  ${paint("dim", w.expirationTime ?? "no-expiry")}`)
        console.log(`  notificationUrl  ${w.notificationUrl}`)
        const ds = w.specification?.options?.filters?.dataTypes?.join(",") ?? "?"
        const scope = w.specification?.options?.filters?.recordChangeScope ?? "(base 전체)"
        console.log(`  dataTypes        ${ds}`)
        console.log(`  scope            ${scope}`)
        if (w.lastNotificationResult) {
            const lnr = w.lastNotificationResult
            const ok = lnr.success
            console.log(`  lastNotification ${ok ? paint("green", "ok") : paint("red", "FAIL")} @ ${lnr.completionTimestamp} (${lnr.durationMs}ms)`)
            if (!ok && lnr.error) console.log(paint("dim", `    error: ${JSON.stringify(lnr.error)}`))
        }
        console.log()
    }
}

async function cmdDelete() {
    const base = need("--base")
    const id = need("--id")
    await airtable("DELETE", `/v0/bases/${base}/webhooks/${id}`)
    console.log(paint("green", `✓ 삭제 완료: ${id}`))
}

async function cmdRefresh() {
    const base = need("--base")
    const id = need("--id")
    const res = await airtable("POST", `/v0/bases/${base}/webhooks/${id}/refresh`)
    console.log(paint("green", `✓ 갱신 완료: ${id}`))
    console.log(`  expirationTime  ${res.expirationTime}`)
}

async function cmdPayloads() {
    const base = need("--base")
    const id = need("--id")
    const cursor = arg("--cursor")
    const limit = arg("--limit") ?? "50"
    const qs = new URLSearchParams()
    if (cursor) qs.set("cursor", cursor)
    qs.set("limit", limit)
    const res = await airtable("GET", `/v0/bases/${base}/webhooks/${id}/payloads?${qs}`)
    console.log(`cursor          ${paint("bold", res.cursor)}`)
    console.log(`mightHaveMore   ${res.mightHaveMore}`)
    console.log(`payloads        ${res.payloads?.length ?? 0} 건`)
    if (flag("--json")) {
        console.log(JSON.stringify(res, null, 2))
        return
    }
    for (const p of res.payloads ?? []) {
        console.log(paint("cyan", `\n@ ${p.timestamp}  txn#${p.baseTransactionNumber}  source=${p.actionMetadata?.source}`))
        const tables = p.changedTablesById ?? {}
        for (const [tblId, t] of Object.entries(tables)) {
            const created = Object.keys(t.createdRecordsById ?? {}).length
            const changed = Object.keys(t.changedRecordsById ?? {}).length
            const destroyed = (t.destroyedRecordIds ?? []).length
            console.log(`  ${tblId}  +${created}  ~${changed}  -${destroyed}`)
        }
    }
}

const commands = {
    register: cmdRegister,
    list: cmdList,
    delete: cmdDelete,
    refresh: cmdRefresh,
    payloads: cmdPayloads,
}

const handler = commands[CMD]
if (!handler) { console.error(paint("red", `✗ 알 수 없는 cmd: ${CMD}`)); process.exit(1) }
handler().catch(e => { console.error(paint("red", `✗ ${e.message}`)); process.exit(2) })
