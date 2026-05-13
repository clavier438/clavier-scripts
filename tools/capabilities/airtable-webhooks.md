# Airtable Webhooks API — 실시간 sync 용 정확한 시그니처

> 자동 주입: UserPromptSubmit hook (`tools/contextInject.json` domain=airtable / domain=worker — 키워드에 `webhook` 포함 시)
> 마지막 갱신: 2026-05-13 (실시간 sync 도입)
> 출처: https://airtable.com/developers/web/api/create-a-webhook · list-webhook-payloads · refresh-a-webhook

---

## 한 줄

**Airtable Webhooks 는 "ping + pull" 패턴.** 변경 발생 → Airtable 이 notificationUrl 로 `POST` 핑 → 워커가 `GET /payloads?cursor=N` 으로 실제 diff 풀. ping body 안에 diff 가 들어있다고 *오해 금지*.

---

## 가능 ✅ (PAT `webhook:manage` scope + 워커가 받음)

### 라이프사이클

| 메서드 | URL | 비고 |
|---|---|---|
| `POST /v0/bases/{baseId}/webhooks` | create | body 에 `notificationUrl` + `specification`. 응답에 `id` + `macSecretBase64` + `expirationTime`. |
| `GET /v0/bases/{baseId}/webhooks` | list | 등록된 webhook 전부 |
| `DELETE /v0/bases/{baseId}/webhooks/{webhookId}` | delete | |
| `POST /v0/bases/{baseId}/webhooks/{webhookId}/refresh` | refresh | expirationTime 을 +7 일 |
| `GET /v0/bases/{baseId}/webhooks/{webhookId}/payloads?cursor=N&limit=50` | pull diff | 응답에 `payloads[]` + 다음 `cursor` + `mightHaveMore` |

### 핵심 제약

- **base 당 webhook 최대 10개**
- **7일 후 expire** — PAT/OAuth 기준. `refresh` 또는 `payloads` 호출 시 만료 시계 자동 갱신 (idle 7일 = 죽음)
- **payload 보존**: webhook 이 expire 된 후로도 7일 동안 payload 조회 가능
- **rate limit**: 일반 PAT rate limit (5 req/sec/base) 적용

---

## create body 스펙

```json
{
  "notificationUrl": "https://<worker>.workers.dev/airtable-webhook",
  "specification": {
    "options": {
      "filters": {
        "dataTypes": ["tableData"],                 // 또는 tableFields / tableMetadata
        "recordChangeScope": "tblXXXXXXXXXXXXXX",   // (선택) 특정 table 만
        "watchDataInFieldIds": ["fld...", "fld..."], // (선택) 특정 field 변경만
        "changeTypes": ["add", "remove", "update"]  // (선택) default = 셋 다
      },
      "includes": {
        "includeCellValuesInFieldIds": "all"        // 또는 ["fld..."] — 변경된 cell 값을 payload 에 박을지
      }
    }
  }
}
```

- `dataTypes` 유효값: `"tableData"` (record CRUD) / `"tableFields"` (field 정의 변경) / `"tableMetadata"` (table 이름·설명)
- `recordChangeScope` 빠지면 base 전체 감시 — 시끄러우니 sync 대상 table 로 좁히는 게 정석
- `includeCellValuesInFieldIds: "all"` 박으면 payload 안에 변경된 cell 값까지 들어와서 *추가 fetch 없이* sync 가능 (★ 권장)

---

## 응답 (create)

```json
{
  "id": "achXXXXXXXXXXXXXX",
  "macSecretBase64": "GBcF...==",          // base64. base64-decode 후 HMAC key 로 사용
  "expirationTime": "2026-05-20T03:14:15.000Z"
}
```

★ `macSecretBase64` 는 **한 번만 응답으로 옴**. 즉시 Doppler `AIRTABLE_WEBHOOK_MAC_SECRET_<scope>` 에 저장 — 잃어버리면 webhook 삭제 후 재등록 필요.

---

## Ping body (Airtable → 워커)

핑은 *내용 없음 신호*. body 는 짧음:

```json
{
  "base": { "id": "appXXXXXXXXXXXXXX" },
  "webhook": { "id": "achXXXXXXXXXXXXXX" },
  "timestamp": "2026-05-13T06:12:34.000Z"
}
```

→ 워커는 이 핑 받으면 `GET /payloads?cursor=N` 호출해서 실제 변경 풀어야 함.

---

## HMAC 서명 (Airtable → 워커)

| 항목 | 값 |
|---|---|
| 헤더 이름 | `X-Airtable-Content-MAC` |
| 헤더 값 포맷 | `hmac-sha256=<base64-mac>` (prefix `hmac-sha256=` 포함) |
| 알고리즘 | HMAC-SHA256 |
| key | `Buffer.from(macSecretBase64, "base64")` — base64 decode 결과 raw bytes |
| 입력 | **raw request body bytes** (parsed JSON 아님 — 정확한 바이트열) |

검증 패턴 (워커):
```ts
const raw = await req.arrayBuffer()
const expected = "hmac-sha256=" + crypto
    .createHmac("sha256", Buffer.from(macSecretBase64, "base64"))
    .update(Buffer.from(raw))
    .digest("base64")
if (req.headers.get("X-Airtable-Content-MAC") !== expected) return new Response("forbidden", { status: 403 })
```

★ Cloudflare Worker 환경은 `crypto.subtle.importKey` + `crypto.subtle.sign` 사용. Node 의 `crypto.createHmac` 와 다름.

---

## payloads 응답 구조 (★ partial sync 의 핵심)

```json
{
  "cursor": 42,                    // 다음 호출 시 보낼 값
  "mightHaveMore": false,
  "payloads": [
    {
      "timestamp": "2026-05-13T06:12:34.000Z",
      "baseTransactionNumber": 12345,
      "payloadFormat": "v0",
      "actionMetadata": {
        "source": "client",        // 또는 publicApi / formSubmission / automation / system
        "sourceMetadata": { "user": { "id": "usr...", "email": "...", "permissionLevel": "create" } }
      },
      "changedTablesById": {
        "tblXXX": {
          "createdRecordsById": {
            "recAAA": {
              "createdTime": "2026-05-13T...",
              "cellValuesByFieldId": { "fld...": "값" }
            }
          },
          "changedRecordsById": {
            "recBBB": {
              "current":   { "cellValuesByFieldId": { "fld...": "new" } },
              "previous":  { "cellValuesByFieldId": { "fld...": "old" } },
              "unchanged": { "cellValuesByFieldId": { ... } }   // includes 옵션에 따라 있을 수도 없을 수도
            }
          },
          "destroyedRecordIds": ["recCCC"]
        }
      }
    }
  ]
}
```

**cursor 의미**: 응답 `cursor` = "다음에 보낼 값". 처음 호출 시 cursor 생략(기본 1). cursor 는 transaction 번호라 monotonic. D1 `worker_state` 에 `airtable_webhook_cursor:{webhookId}` 키로 보관 → idempotent.

**mightHaveMore=true** 면 즉시 다음 cursor 로 재호출. false 면 종료.

---

## 잘못 알기 쉬운 것

- ❌ "ping body 안에 변경 record 들이 들어있다" → **거짓**. ping 은 신호만. `/payloads` 로 풀어야 함.
- ❌ "webhook 등록만 해두면 영원히 산다" → **거짓**. 7일 expire. cron 으로 6일마다 refresh 필요 (또는 polling 시 `/payloads` 호출만 해도 시계 갱신).
- ❌ "HMAC key 는 macSecretBase64 문자열 그대로" → **거짓**. base64 decode 후의 raw bytes 가 key.
- ❌ "HMAC 입력은 JSON.parse 후 stringify" → **거짓**. raw request body bytes. parse-restringify 시 공백·키 순서 달라져 MAC 깨짐.
- ❌ "header 값은 base64 문자열만" → **거짓**. `hmac-sha256=` prefix 필수.
- ❌ "webhook 삭제하고 같은 url 로 다시 만들면 macSecret 동일" → **거짓**. 매번 새 secret. 재등록 시 Doppler 갱신 필수.
- ❌ "Cloudflare worker 에서 `require('crypto').createHmac`" → **거짓**. workerd 는 node:crypto compat 부분만. `crypto.subtle.sign("HMAC", ...)` 가 정석. nodejs_compat flag 있으면 Buffer + createHmac 가능 — wrangler.toml 확인.
- ❌ "payload 중복 옴" → **거짓에 가까움**. cursor 기반 idempotent — 같은 cursor 로 두번 호출하면 같은 payload. 워커 측 cursor advance 가 atomic 이어야 함 (D1 transaction).

---

## 실시간 sync 권장 와이어링

```
Airtable change
    ↓ (Airtable POSTs ping)
Cloudflare Worker  POST /airtable-webhook
    ↓ ① HMAC 검증
    ↓ ② D1 에서 cursor 읽기 (airtable_webhook_cursor:{whId})
    ↓ ③ GET /payloads?cursor=N  (loop while mightHaveMore)
    ↓ ④ payloads → changedRecordsById 합쳐서 recordId set 추출
    ↓ ⑤ 기존 partial-sync use case 호출 (이미 platform-agnostic 추상화 있음)
    ↓ ⑥ cursor 업데이트 (D1)
    ↓ ⑦ 200 OK (Airtable 가 200 외 응답 받으면 자동 재시도 — 최대 ?회)

cron (6일마다)
    → POST /webhooks/{id}/refresh  (또는 /payloads 호출만으로도 시계 갱신됨 — 보험으로 둘 다)
```

응답이 4xx 면 Airtable 가 재시도. **5xx 도 재시도** (멱등 보장 필수 — cursor 가 그 역할). 200 받으면 종료.

---

## 시도 전 체크리스트

1. PAT scope 에 `webhook:manage` 포함됐는지 확인 (기존 `AIRTABLE_PAT` 는 `schema.bases:write`+`data.records:read/write` 만 — scope 추가 필요)
2. notificationUrl 은 **HTTPS + 공인 인증서** 필수. workers.dev 또는 custom domain 만 됨.
3. `macSecretBase64` 받자마자 Doppler 저장 — 응답 로그에만 남기지 말 것
4. 첫 등록 직후 `/payloads` 한 번 호출해서 cursor 1 받아 D1 에 저장 → 이후 ping 처리 시작점
5. 워커 라우트는 `Promise.race` 로 30s timeout 걸고, payloads loop 가 오래 걸리면 background fetch + 200 빨리 반환 (Airtable timeout 회피)

---

## 작업 시작 전 자동 주입 키워드

`webhook | airtable.*webhook | macSecret | macSecretBase64 | X-Airtable-Content-MAC | hmac-sha256 | changedTablesById | createdRecordsById | changedRecordsById | destroyedRecordIds | webhook:manage | notificationUrl | airtable_webhook_cursor`
