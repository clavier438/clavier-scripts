#!/usr/bin/env node
/**
 * offer — 오퍼를 마스터 템플릿으로 이메일 HTML 화 → (수동 발송) → 웹 아카이브를 Framer 오퍼 디테일에 연결
 *
 * 전략: 스티비 웹 아카이브 = 오퍼 디테일 페이지. 그 URL 을 Framer CMS 오퍼 카드에 링크.
 * 마스터 table 템플릿 1개(datasets/offer-email/) + 콘텐츠(Airtable 레코드)만 스왑.
 *
 * 범위 (지금 동작하는 것 — 스티비 API 무관, 전부 groundable):
 *   offer draft <레코드URL|recId>            레코드 → 템플릿 채워 로컬 HTML 미리보기
 *   offer link  <레코드URL|recId> <archiveUrl>   아카이브 URL → Airtable → framer push
 *
 * 현재 루프: draft → 스티비 HTML 편집기에 붙여넣어 수동 발송 → 아카이브 URL 복사 → link.
 *
 * 실호출 발송 자동화 = 나중에 별도 모듈로 붙임 (스티비 API 계약 확정 후):
 *   transport 는 tools/lib/stibee-api.mjs (준비됨, 계약 확정 시 CONFIRM 제거).
 *   확정되면 `send` verb 를 이 파일에 추가하고 그 모듈을 호출하면 됨.
 *   계약(엔드포인트·페이로드·아카이브 URL 필드) 확정 전엔 만들지 않는다 (추측 자동화 금지).
 *
 * 재사용 (reuse-first): airtable-api · doppler-wrap · cli-color · framer push(spawn).
 *
 * 환경변수 (Doppler clavier/prd 자동 주입):
 *   AIRTABLE_PAT            Airtable 레코드 read/write
 *   OFFER_TEMPLATE_DIR      템플릿 폴더 override (기본: datasets/offer-email)
 *   AIRTABLE_BASE_ID/_ID    recId 단독 입력 시 기본 base/table
 */

import "./lib/freshness.mjs"

import { spawnSync } from "child_process"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

import { createClient as airtableClient } from "./lib/airtable-api.mjs"
import { ensureDoppler } from "./lib/doppler-wrap.mjs"
import { bold, dim, cyan, green, yellow, red, gray } from "./lib/cli-color.mjs"

ensureDoppler({
  project: "clavier",
  config: "prd",
  sentinelEnv: "OFFER_DOPPLER_INJECTED",
  requiredEnvs: ["AIRTABLE_PAT"],
  fallbackEnvFile: "~/.clavier/env",
})

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = dirname(SCRIPT_DIR)
const TEMPLATE_DIR = process.env.OFFER_TEMPLATE_DIR || join(REPO_ROOT, "datasets", "offer-email")
const LOCAL_DIR = join(REPO_ROOT, ".local", "offer")

// ── Airtable 레코드 URL 파싱 ──────────────────────────────────────────────
// 전체 URL(airtable.com/app../tbl../rec..) 또는 rec.. 단독(+ env 기본 base/table) 모두 허용.
function parseRecordRef(ref) {
  const app = ref.match(/app[A-Za-z0-9]+/)?.[0] || process.env.AIRTABLE_BASE_ID
  const tbl = ref.match(/tbl[A-Za-z0-9]+/)?.[0] || process.env.AIRTABLE_TABLE_ID
  const rec = ref.match(/rec[A-Za-z0-9]+/)?.[0]
  if (!app || !tbl || !rec) {
    fail(
      `레코드 참조 파싱 실패: "${ref}"\n` +
        `  전체 Airtable 레코드 URL(app../tbl../rec.. 포함) 또는 rec.. + AIRTABLE_BASE_ID/AIRTABLE_TABLE_ID 필요.`
    )
  }
  return { baseId: app, tableId: tbl, recordId: rec }
}

// ── 슬롯 채우기 (스키마 적응형) ────────────────────────────────────────────
function loadSlotMap() {
  return JSON.parse(readFileSync(join(TEMPLATE_DIR, "slot-map.json"), "utf8"))
}

function fillTemplate(fields, map) {
  const template = readFileSync(join(TEMPLATE_DIR, "template.html"), "utf8")
  const out = {}
  for (const [slot, candidates] of Object.entries(map.slots || {})) {
    // 레코드에 실제 존재하는 첫 후보 필드를 사용 → 없으면 defaults → 빈 문자열.
    const hit = candidates.find((f) => fields[f] != null && fields[f] !== "")
    let val = hit != null ? fields[hit] : map.defaults?.[slot] ?? ""
    if (Array.isArray(val)) val = val[0]?.url || val[0] || "" // attachment 필드 대응
    out[slot] = String(val)
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => out[k] ?? "")
}

// ── verbs ────────────────────────────────────────────────────────────────
async function draft(ref) {
  const { baseId, tableId, recordId } = parseRecordRef(ref)
  const at = airtableClient(process.env.AIRTABLE_PAT)
  const record = await at.getRecord(baseId, tableId, recordId)
  const html = fillTemplate(record.fields || {}, loadSlotMap())
  mkdirSync(LOCAL_DIR, { recursive: true })
  const path = join(LOCAL_DIR, `offer-${recordId}.html`)
  writeFileSync(path, html)
  console.log(`${green("✓")} 미리보기 HTML 생성: ${bold(path)}`)
  console.log(dim(`  브라우저로 열어 데스크탑/모바일 확인 →`))
  console.log(dim(`  스티비 HTML 편집기에 붙여넣어 발송 → 아카이브 URL 복사 → offer link ${ref} <archiveUrl>`))
}

async function link(ref, archiveUrl) {
  if (!archiveUrl || !/^https?:\/\//.test(archiveUrl)) fail(`아카이브 URL 이 http(s) 가 아님: "${archiveUrl}"`)
  const { baseId, tableId, recordId } = parseRecordRef(ref)
  const field = loadSlotMap().archive_url_field || "스티비아카이브"
  const at = airtableClient(process.env.AIRTABLE_PAT)
  await at.batchPatch(baseId, tableId, [{ id: recordId, fields: { [field]: archiveUrl } }])
  console.log(`${green("✓")} Airtable [${field}] ← ${archiveUrl}`)

  // framer push 재사용 (재발명 X) — framer.mjs 가 Doppler self-respawn 으로 자기 환경 주입.
  const framerPath = join(SCRIPT_DIR, "framer.mjs")
  console.log(dim("\n→ framer push (Airtable → SQLite → Framer CMS) ..."))
  const r = spawnSync("node", [framerPath, "push"], { stdio: "inherit" })
  if (r.status !== 0) {
    console.log(yellow(`\n⚠ framer push 비정상 종료(code ${r.status}). 수동으로 'framer push' 재시도.`))
    process.exitCode = r.status || 1
  } else {
    console.log(green("\n✓ Framer CMS 오퍼 카드에 아카이브 URL 반영 완료."))
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(red(`✗ ${msg}`))
  process.exit(1)
}

function help() {
  console.log(`${bold("offer")} — 오퍼 → 이메일 HTML → (수동 발송) → 웹 아카이브를 Framer 오퍼 디테일에 연결

${cyan("사용:")}
  offer draft <레코드URL|recId>                레코드 → 마스터 템플릿 채워 로컬 HTML 미리보기
  offer link  <레코드URL|recId> <archiveUrl>   아카이브 URL → Airtable → framer push

${cyan("루프:")}
  draft → 스티비 HTML 편집기에 붙여넣어 발송 → 아카이브 URL 복사 → link.
  디자인은 datasets/offer-email/template.html 하나만. 오퍼마다 콘텐츠만 스왑.

${gray("실호출 발송 자동화는 스티비 API 계약 확정 후 별도 모듈(lib/stibee-api.mjs transport)로 추가 — 그때 send verb 가 붙는다.")}`)
}

// ── dispatch ────────────────────────────────────────────────────────────────
const [verb, ...rest] = process.argv.slice(2)
const handlers = {
  draft: () => draft(rest[0] || fail("레코드 URL/recId 필요")),
  link: () => link(rest[0] || fail("레코드 URL/recId 필요"), rest[1] || fail("archiveUrl 필요")),
}
const run = handlers[verb]
if (!run) {
  help()
  process.exit(verb ? 1 : 0)
}
run().catch((e) => fail(e.stack || e.message))
