#!/usr/bin/env node
/**
 * framesync-admin — FrameSync 고객 수동 관리 CLI
 *
 * 사용법:
 *   framesync-admin list                          # 전체 고객 목록
 *   framesync-admin add <tenant-id>               # 인터랙티브 등록
 *   framesync-admin add <tenant-id> \
 *     --base appXXXX --pat patXXXX \
 *     --framer-url https://... --framer-token XXX  # 즉시 등록
 *   framesync-admin info <tenant-id>              # 상세 (secret 마스킹)
 *   framesync-admin remove <tenant-id>            # 삭제 (확인 후)
 *   framesync-admin activate <tenant-id>          # 활성화
 *   framesync-admin deactivate <tenant-id>        # 비활성화 (삭제 말고 일시 정지)
 *
 * 전제: doppler run 으로 CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_D1_CUSTOMERS_ID 주입.
 *       또는 env 에 직접 세팅.
 *
 * D1 ID (framesync-customers): 76bf5389-0f1a-46a9-bc3e-2c0fde6f7d64
 */

import { assertCustomerId } from "../tenant/isolation.mjs"
import { bold, dim, green, red, yellow, cyan } from "../../tools/lib/cli-color.mjs"
import { createInterface } from "readline"

const D1_ID = process.env.CLOUDFLARE_D1_CUSTOMERS_ID ?? "76bf5389-0f1a-46a9-bc3e-2c0fde6f7d64"
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_TOKEN   = process.env.CLOUDFLARE_API_TOKEN

// ── D1 HTTP API 래퍼 ──────────────────────────────────────────────────────────
async function d1Query(sql, params = []) {
    if (!CF_ACCOUNT || !CF_TOKEN) {
        throw new Error(
            "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN 미설정.\n" +
            "  doppler run -- node saas/cli/framesync-admin.mjs 로 실행하세요."
        )
    }
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_ID}/query`
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${CF_TOKEN}`,
            "Content-Type":  "application/json",
        },
        body: JSON.stringify({ sql, params }),
    })
    const json = await res.json()
    if (!json.success) throw new Error(`D1 오류: ${JSON.stringify(json.errors)}`)
    return json.result?.[0]?.results ?? []
}

// ── helpers ───────────────────────────────────────────────────────────────────
function mask(s) {
    if (!s) return dim("(없음)")
    return s.slice(0, 4) + "…" + dim(`(${s.length}자)`)
}

function ask(rl, q) {
    return new Promise(resolve => rl.question(q, resolve))
}

function printRow(r) {
    const status = r.active ? green("● 활성") : dim("○ 비활성")
    console.log(`  ${status}  ${bold(r.tenant_id)}  ${dim(r.plan)}  ${dim(r.created_at?.slice(0,10))}`)
}

// ── 커맨드 ────────────────────────────────────────────────────────────────────
const [,, cmd, tenantArg, ...rest] = process.argv

async function cmdList() {
    const rows = await d1Query("SELECT tenant_id, plan, active, created_at FROM customers ORDER BY created_at DESC")
    if (!rows.length) { console.log(dim("  등록된 고객 없음")); return }
    console.log(bold(`\n고객 ${rows.length}명`))
    rows.forEach(printRow)
    console.log()
}

async function cmdAdd(tenantId, flags) {
    assertCustomerId(tenantId)

    let base      = flags["--base"]
    let pat       = flags["--pat"]
    let framerUrl = flags["--framer-url"]
    let framerTok = flags["--framer-token"]
    let plan      = flags["--plan"] ?? "starter"
    let notes     = flags["--notes"] ?? ""

    if (!base || !pat || !framerUrl || !framerTok) {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        console.log(bold(`\n고객 등록: ${tenantId}`))
        if (!base)      base      = await ask(rl, "  Airtable Base ID (appXXXX): ")
        if (!pat)       pat       = await ask(rl, "  Airtable PAT (patXXXX...): ")
        if (!framerUrl) framerUrl = await ask(rl, "  Framer Plugin URL: ")
        if (!framerTok) framerTok = await ask(rl, "  Framer Token: ")
        if (!plan)      plan      = (await ask(rl, "  Plan [starter/agency] (기본 starter): ")) || "starter"
        notes = await ask(rl, "  메모 (선택): ")
        rl.close()
    }

    // 이미 있는지 확인
    const existing = await d1Query("SELECT tenant_id FROM customers WHERE tenant_id = ?", [tenantId])
    if (existing.length) {
        console.log(yellow(`  ⚠️  ${tenantId} 이미 존재. 덮어씌울까요? (y/N) `))
        const rl2 = createInterface({ input: process.stdin, output: process.stdout })
        const ans = await ask(rl2, "  ")
        rl2.close()
        if (ans.toLowerCase() !== "y") { console.log(dim("  취소.")); return }
    }

    await d1Query(
        `INSERT OR REPLACE INTO customers
           (tenant_id, airtable_base, airtable_pat, framer_url, framer_token, plan, notes, active)
         VALUES (?,?,?,?,?,?,?,1)`,
        [tenantId, base, pat, framerUrl, framerTok, plan, notes]
    )
    console.log(green(`\n  ✓ ${tenantId} 등록 완료 (plan: ${plan})`))
    console.log(dim(`  다음: framer push --tenant ${tenantId} 로 첫 sync 실행\n`))
}

async function cmdInfo(tenantId) {
    const rows = await d1Query("SELECT * FROM customers WHERE tenant_id = ?", [tenantId])
    if (!rows.length) { console.log(red(`  고객 없음: ${tenantId}`)); return }
    const r = rows[0]
    console.log(bold(`\n${r.tenant_id}`))
    console.log(`  plan        : ${cyan(r.plan)}`)
    console.log(`  active      : ${r.active ? green("활성") : dim("비활성")}`)
    console.log(`  created     : ${r.created_at}`)
    console.log(`  airtable    : base=${cyan(r.airtable_base)}  pat=${mask(r.airtable_pat)}`)
    console.log(`  framer url  : ${cyan(r.framer_url)}`)
    console.log(`  framer token: ${mask(r.framer_token)}`)
    if (r.utm_source)   console.log(`  utm source  : ${r.utm_source}`)
    if (r.utm_medium)   console.log(`  utm medium  : ${r.utm_medium}`)
    if (r.utm_campaign) console.log(`  utm campaign: ${r.utm_campaign}`)
    if (r.notes)        console.log(`  notes       : ${dim(r.notes)}`)
    console.log()
}

async function cmdRemove(tenantId) {
    const rows = await d1Query("SELECT tenant_id FROM customers WHERE tenant_id = ?", [tenantId])
    if (!rows.length) { console.log(red(`  고객 없음: ${tenantId}`)); return }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ans = await ask(rl, `  ${red("삭제")} ${bold(tenantId)} — 확실? (y/N) `)
    rl.close()
    if (ans.toLowerCase() !== "y") { console.log(dim("  취소.")); return }
    await d1Query("DELETE FROM customers WHERE tenant_id = ?", [tenantId])
    console.log(green(`  ✓ ${tenantId} 삭제됨\n`))
}

async function cmdSetActive(tenantId, active) {
    await d1Query("UPDATE customers SET active=? WHERE tenant_id=?", [active ? 1 : 0, tenantId])
    console.log(green(`  ✓ ${tenantId} ${active ? "활성화" : "비활성화"} 완료\n`))
}

// ── 플래그 파싱 ───────────────────────────────────────────────────────────────
function parseFlags(args) {
    const flags = {}
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--") && args[i+1] && !args[i+1].startsWith("--")) {
            flags[args[i]] = args[i+1]; i++
        }
    }
    return flags
}

// ── 진입점 ────────────────────────────────────────────────────────────────────
const flags = parseFlags(rest)

switch (cmd) {
    case "list":       await cmdList(); break
    case "add":        await cmdAdd(tenantArg, flags); break
    case "info":       await cmdInfo(tenantArg); break
    case "remove":     await cmdRemove(tenantArg); break
    case "activate":   await cmdSetActive(tenantArg, true); break
    case "deactivate": await cmdSetActive(tenantArg, false); break
    default:
        console.log(`
${bold("framesync-admin")} — FrameSync 고객 관리

  ${cyan("list")}                       고객 전체 목록
  ${cyan("add")} <id> [--base --pat     고객 등록 (인터랙티브 또는 플래그)
       --framer-url --framer-token
       --plan --notes]
  ${cyan("info")} <id>                  상세 보기 (secret 마스킹)
  ${cyan("remove")} <id>               삭제
  ${cyan("activate")} / ${cyan("deactivate")} <id>  활성 토글

${dim("실행: doppler run -- node saas/cli/framesync-admin.mjs <cmd>")}
`)
}
