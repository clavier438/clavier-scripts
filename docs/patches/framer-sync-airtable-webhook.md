# Patch: framer-sync 워커에 Airtable webhook 라우트 + cron 추가

> ⚠️ **2026-05-13 STALE 마크** — 본 명세의 "기존 워커엔 없으니 paste" 가정이 baseline 점검 후 사실과 다름. 워커는 이미 `POST /configure` 안에서 webhook 자동 등록 + `POST /webhook` 라우트 ingest + cron 5일 refresh 모두 처리 중 (sisoso/mukayu 둘 다 실가동 검증). 본 명세는 *paste 가이드* 가 아니라 **향상 가이드** (HMAC 검증 + partial sync 도입) 로 재해석하라. webhook 모드 토글 (stage1-only ↔ full) 은 platform-workers PR #2 에서 별도 반영.

> 대상 repo: `clavier438/platform-workers`
> 작업 위치: `platform-workers/framer-sync/`
> 적용 방법: ⚠️ 그대로 paste X — 현재 워커의 `routes/configure.ts` `handleWebhook` 와 `adapters/airtable.ts` `registerWebhook/refreshWebhook` 위에 HMAC 검증 + partial sync 만 *추가* 하는 형태로 재해석
> 짝 파일: `clavier-scripts/tools/airtable-webhook-register.mjs` + `airtable-webhook-verify.mjs`
> 관련 capability: `clavier-scripts/tools/capabilities/airtable-webhooks.md`

---

## 한 줄

Airtable 변경 → CF 워커 즉시 partial-sync. ngrok·OCI 없이 워커만으로 완결.

---

## 데이터 흐름

```
Airtable 변경
    ↓ Airtable POSTs ping
[framer-sync worker]  POST /airtable-webhook
    ↓ ① HMAC 검증 (X-Airtable-Content-MAC)
    ↓ ② D1 worker_state.airtable_webhook_cursor 읽기
    ↓ ③ ctx.waitUntil 로 background 작업 enqueue + 즉시 200 반환
    ↓ ④ (백그라운드) GET /payloads?cursor=N loop while mightHaveMore
    ↓ ⑤ payloads → recordId set 추출 → 기존 partial-sync use case 호출
    ↓ ⑥ cursor 갱신 (D1)

[cron — 6일마다 09:00 UTC]
    → 모든 등록된 webhook 에 POST /refresh
```

---

## ① wrangler.toml 추가

```toml
# 기존 [env.<worker>] 섹션 각각에 추가
[triggers]
crons = ["0 9 */6 * *"]   # 6일마다 09:00 UTC — webhook 7일 expire 안전마진

# 새 secret 두 개 (Doppler → wrangler 자동 sync 는 tools/doppler-sync-wrangler.sh)
# AIRTABLE_PAT                                     (이미 있음 — scope 에 webhook:manage 추가 필요)
# AIRTABLE_WEBHOOK_MAC_SECRET_<baseId>             base 별로
# AIRTABLE_WEBHOOK_IDS                             등록된 {baseId: webhookId} JSON — refresh cron 용
```

> `nodejs_compat` flag 가 이미 켜져 있으면 `Buffer` 사용 가능. 아니면 아래 코드의 base64 변환부를 `atob`/`btoa` 로 교체.

---

## ② Hono 라우트 (`src/http/routes/airtableWebhook.ts` 신규)

```ts
import { Hono } from "hono"
import type { Env } from "../env"
import { getWorkerState, setWorkerState } from "../../adapters/d1/workerState"
import { runPartialSync } from "../../usecases/partialSync"

export const airtableWebhookRoute = new Hono<{ Bindings: Env }>()

airtableWebhookRoute.post("/airtable-webhook", async (c) => {
    const raw = await c.req.arrayBuffer()
    const sigHeader = c.req.header("X-Airtable-Content-MAC") ?? ""
    let body: { base?: { id?: string }; webhook?: { id?: string }; timestamp?: string }
    try { body = JSON.parse(new TextDecoder().decode(raw)) } catch { return c.text("bad json", 400) }

    const baseId = body.base?.id
    const webhookId = body.webhook?.id
    if (!baseId || !webhookId) return c.text("missing base/webhook id", 400)

    // ① HMAC 검증
    const secretKey = `AIRTABLE_WEBHOOK_MAC_SECRET_${baseId}` as const
    const macSecretBase64 = (c.env as Record<string, string | undefined>)[secretKey]
    if (!macSecretBase64) {
        console.error(`[airtable-webhook] no secret for ${baseId}`)
        return c.text("no secret configured", 500)
    }
    const ok = await verifyMac(raw, sigHeader, macSecretBase64)
    if (!ok) return c.text("forbidden", 403)

    // ② cursor 풀 → partial sync — 무거우니 background
    c.executionCtx.waitUntil(processWebhook(c.env, baseId, webhookId))

    // ③ 즉시 200 — Airtable timeout 회피
    return c.text("ok", 200)
})

async function verifyMac(raw: ArrayBuffer, header: string, macSecretBase64: string): Promise<boolean> {
    if (!header.startsWith("hmac-sha256=")) return false
    const expectedBase64 = header.slice("hmac-sha256=".length)
    const keyBytes = base64ToBytes(macSecretBase64)
    const key = await crypto.subtle.importKey(
        "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    )
    const sig = await crypto.subtle.sign("HMAC", key, raw)
    const actualBase64 = bytesToBase64(new Uint8Array(sig))
    return timingSafeEqual(expectedBase64, actualBase64)
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}
function bytesToBase64(bytes: Uint8Array): string {
    let bin = ""
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
}
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let r = 0
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return r === 0
}

async function processWebhook(env: Env, baseId: string, webhookId: string): Promise<void> {
    const cursorKey = `airtable_webhook_cursor:${webhookId}`
    let cursor = Number((await getWorkerState(env.DB, cursorKey)) ?? "1")
    const changedRecordIdsByTable = new Map<string, Set<string>>()

    while (true) {
        const url = `https://api.airtable.com/v0/bases/${baseId}/webhooks/${webhookId}/payloads?cursor=${cursor}&limit=50`
        const r = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}` } })
        if (!r.ok) {
            console.error(`[airtable-webhook] payloads fetch ${r.status} ${await r.text()}`)
            return
        }
        const data = await r.json() as {
            cursor: number
            mightHaveMore: boolean
            payloads: Array<{
                changedTablesById?: Record<string, {
                    createdRecordsById?: Record<string, unknown>
                    changedRecordsById?: Record<string, unknown>
                    destroyedRecordIds?: string[]
                }>
            }>
        }
        for (const p of data.payloads ?? []) {
            for (const [tblId, t] of Object.entries(p.changedTablesById ?? {})) {
                const set = changedRecordIdsByTable.get(tblId) ?? new Set<string>()
                for (const recId of Object.keys(t.createdRecordsById ?? {})) set.add(recId)
                for (const recId of Object.keys(t.changedRecordsById ?? {})) set.add(recId)
                for (const recId of t.destroyedRecordIds ?? []) set.add(recId)   // destroy 도 sync 필요
                changedRecordIdsByTable.set(tblId, set)
            }
        }
        cursor = data.cursor
        await setWorkerState(env.DB, cursorKey, String(cursor))
        if (!data.mightHaveMore) break
    }

    if (changedRecordIdsByTable.size === 0) {
        console.log(`[airtable-webhook] ${webhookId} → no changes`)
        return
    }

    // 기존 partial-sync use case 호출. 이미 platform-agnostic 으로 추상화돼 있으니 store 만 D1 어댑터로 주입.
    await runPartialSync(env, baseId, changedRecordIdsByTable)
}
```

> `runPartialSync` 는 기존 framer-sync use case 의 signature 에 맞춰 조정. 만약 기존 use case 가 "전체 sync" 만 노출돼 있으면, *변경된 recordId 만 받는* 새 entry point 가 use-case layer 에 추가돼야 함 (Clean Architecture: HTTP layer 가 use case 의 partial 입력 받는 부분만 노출).

---

## ③ Worker entry (`src/index.ts`) 에 라우트 + cron 결합

```ts
import { airtableWebhookRoute } from "./http/routes/airtableWebhook"

const app = new Hono<{ Bindings: Env }>()
// 기존 라우트들...
app.route("/", airtableWebhookRoute)

export default {
    fetch: app.fetch,
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        // 6일마다 webhook refresh — expirationTime 7일 안전마진
        const idsJson = env.AIRTABLE_WEBHOOK_IDS
        if (!idsJson) { console.log("[cron] no webhook ids configured"); return }
        const ids = JSON.parse(idsJson) as Record<string, string>   // { baseId: webhookId }
        for (const [baseId, whId] of Object.entries(ids)) {
            const r = await fetch(
                `https://api.airtable.com/v0/bases/${baseId}/webhooks/${whId}/refresh`,
                { method: "POST", headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}` } }
            )
            console.log(`[cron] refresh ${baseId}/${whId} → ${r.status}`)
        }
    },
}
```

---

## ④ D1 마이그레이션 (필요 시)

`worker_state` 테이블 이미 있으면 추가 작업 없음. 새 키만 사용:
- `airtable_webhook_cursor:{webhookId}` — number, monotonic
- `airtable_webhook_last_seen:{webhookId}` — ISO timestamp, 디버그용 (optional)

---

## ⑤ 등록 절차 (사용자 1회 작업)

```bash
# 1. PAT scope 확장 — Airtable web UI 에서 webhook:manage 추가
#    (https://airtable.com/create/tokens 에서 기존 token 편집)

# 2. webhook 등록
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/scripts
doppler run --project clavier --config prd -- \
  node tools/airtable-webhook-register.mjs register \
    --base appIrjwfcGeVMI9xb \
    --url https://framer-sync.<your-subdomain>.workers.dev/airtable-webhook \
    --table tblXXXXXXXXXXXXXX \
    --include-values all

# 3. 응답의 macSecretBase64 + webhook id 를 Doppler 에 저장
doppler secrets set --project clavier --config prd \
  AIRTABLE_WEBHOOK_MAC_SECRET_appIrjwfcGeVMI9xb=<base64>

# AIRTABLE_WEBHOOK_IDS 는 등록한 모든 webhook 의 {baseId: id} JSON
doppler secrets set --project clavier --config prd \
  AIRTABLE_WEBHOOK_IDS='{"appIrjwfcGeVMI9xb":"achXXXXXXXXXXXXXX"}'

# 4. doppler → wrangler sync + 워커 배포
bash tools/doppler-sync-wrangler.sh sisoso
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/code/projects/platform-workers/framer-sync
wrangler deploy

# 5. 검증
node tools/airtable-webhook-verify.mjs ping \
  --url https://framer-sync.<sub>.workers.dev/airtable-webhook \
  --secret $AIRTABLE_WEBHOOK_MAC_SECRET_appIrjwfcGeVMI9xb
# → 200 ok 기대

node tools/airtable-webhook-verify.mjs ping --bad ...
# → 403 forbidden 기대 (HMAC 검증 살아있는지)

# 6. 실제 Airtable 에서 record 1개 수정 → 워커 log 에 [airtable-webhook] 로그 + framer 반영 확인
wrangler tail
```

---

## ⑥ 회귀 방어 체크리스트

- [ ] `framer push` (전체 sync) 와 webhook partial sync 결과가 동등 — record 1개 webhook 으로 들어왔을 때 full sync 한 것과 같은 stage1_cache hash 산출
- [ ] 같은 cursor 로 두 번 호출 → 두 번째는 변경 없음 (idempotent)
- [ ] 잘못된 MAC → 403, 정상 MAC → 200
- [ ] webhook 7일 expire 안 일어남 (cron 동작 wrangler log 확인)
- [ ] base 당 webhook 10개 한도 — 이 한도 안에서 운영 (테이블별로 쪼개려면 신중)

---

## ⑦ 회귀 시 rollback

webhook 만 삭제하면 끝. 워커 라우트는 그대로 둬도 무해 (들어오는 ping 만 사라짐).

```bash
doppler run --project clavier --config prd -- \
  node tools/airtable-webhook-register.mjs delete --base appXXX --id achXXX
```

기존 `framer push` 수동 흐름은 그대로 살아있어 영향 없음.
