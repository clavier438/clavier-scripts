# Handoff — Airtable → Framer 실시간 이벤트드리븐 sync

> 인수인계 brief: 다음 사람(또는 cold-start Claude 세션)이 이 한 페이지만 읽어도 작업을 이어받을 수 있게.
> 작성: 2026-05-13
> 브랜치: `c` (이 인수인계 패키지) — 작업 본체 브랜치 `claude/airtable-realtime-sync-WkDSe` 와 동일 tree
> PR: https://github.com/clavier0/clavier-scripts/pull/5 (draft)

---

## 0. 한 줄

**Airtable 변경 → framer-sync 워커가 Airtable Webhook 직접 받아 partial sync.** OCI ngrok·VM 없이 Cloudflare Worker 단독 완결. 본 repo(`clavier-scripts`) 측 도구·문서는 *완료*, `platform-workers` 측 워커 라우트는 *paste 대기*.

---

## 1. 왜 이 설계인가 (간략)

- 워커는 이미 `*.workers.dev` 공인 HTTPS — Airtable Webhook 직접 도달 가능
- ngrok / OCI 이전 / Automation / polling 강화 4가지 대안은 모두 운영비용 증가만 가져옴 (상주 프로세스·secret·모니터링 증가)
- 거부 사유 상세: `docs/decisions/2026-05-13-airtable-realtime-sync.md` (ADR 초안)

---

## 2. 작업 위치 분포 (왜 여러 repo 인가)

| repo | 이 작업에서 하는 일 | 상태 |
|---|---|---|
| `clavier0/clavier-scripts` (이곳) | capability 문서 + 등록/검증 CLI + 패치/ADR staging | ✅ 완료 (이 PR) |
| `clavier0/platform-workers` | framer-sync 워커에 `POST /airtable-webhook` 라우트 + cron 추가 | ⏸ 사용자 paste 대기 |
| `clavier0/clavier-hq` | DECISIONS / MAP / SYSTEM_ENV 갱신 | ⏸ 사용자 commit 대기 |
| Doppler (`clavier`/`prd`, `prd_mukayu`) | 새 secret 3종 등록 | ⏸ 등록 응답 받은 후 |
| Airtable PAT | scope `webhook:manage` 추가 | ⏸ web UI 1회 작업 |

> 이번 Claude 세션의 GitHub MCP 스코프는 `clavier-scripts` 만. 나머지 4 곳은 사용자가 진행해야 함.

---

## 3. 파일 맵 (이 repo 안)

| 파일 | 역할 | 변경 |
|---|---|---|
| `tools/capabilities/airtable-webhooks.md` | Airtable Webhooks API 정확한 시그니처 (ping body / HMAC / cursor / 함정 8개). UserPromptSubmit hook 으로 자동 주입 — 다음 세션이 "webhook" 키워드 칠 때 컨텍스트에 자동 들어감 | 신규 |
| `tools/contextInject.json` | 위 capability 의 키워드 매칭 등록 (`webhook`, `macSecretBase64`, `X-Airtable-Content-MAC` 등) | 1개 도메인 추가 |
| `tools/airtable-webhook-register.mjs` | Airtable Webhooks API 라이프사이클 CLI — register/list/delete/refresh/payloads 5 서브커맨드. PAT scope `webhook:manage` 필요. doppler run 으로 실행 | 신규, 실행 권한 박힘 |
| `tools/airtable-webhook-verify.mjs` | (a) HMAC 로직 self-test — Node crypto ↔ WebCrypto 동등성 + tamper detection + prefix 검사. (b) 라이브 워커에 합성 ping (정상/잘못된 MAC) | 신규, 실행 권한 박힘 |
| `docs/patches/framer-sync-airtable-webhook.md` | platform-workers 측에 paste 할 Hono 라우트 + WebCrypto HMAC 검증 + ctx.waitUntil 백그라운드 payload pull + cron scheduled handler. 등록 절차 + 회귀 방어 체크리스트 + rollback 포함 | 신규 |
| `docs/decisions/2026-05-13-airtable-realtime-sync.md` | ADR 초안 — 결정/거부된 대안/SSOT 12 문서 갱신 체크리스트. clavier-hq 합의 후 정식 이동 | 신규 |
| `HANDOFF.md` | (이 파일) 인수인계 패키지 | 신규 |

---

## 4. 데이터 흐름 (재현용)

```
Airtable change
    │
    ▼ POST ping  (헤더 X-Airtable-Content-MAC: hmac-sha256=<b64>)
[framer-sync worker]  POST /airtable-webhook
    │
    ① HMAC 검증 (WebCrypto importKey HMAC-SHA256, timing-safe compare)
    │  └─ 실패 → 403 forbidden
    ② D1 worker_state.airtable_webhook_cursor:{whId} 읽기 (없으면 1)
    ③ 즉시 200 ok 반환  +  ctx.waitUntil(processWebhook(...))
    │
    ── background ──
    ④ GET /v0/bases/{base}/webhooks/{whId}/payloads?cursor=N&limit=50
       while data.mightHaveMore { N = data.cursor; reloop }
    ⑤ payloads → changedTablesById 합쳐서 (tableId → recordId set) 추출
       create / change / destroy 셋 다 한 set 으로 (destroy 도 sync 트리거)
    ⑥ 기존 partial-sync use case 호출 (platform-agnostic 추상화 활용)
    ⑦ D1 cursor 키 update (atomic — write 끝까지 끝나야 다음 ping 안전)

[cron — 6일마다 09:00 UTC]
    환경변수 AIRTABLE_WEBHOOK_IDS = {"appXXX":"achXXX", ...}
    각 entry 에 POST /v0/bases/{base}/webhooks/{id}/refresh
    → expirationTime +7일
```

---

## 5. 사용자 follow-up 순서 (그대로 따라하면 됨)

### Step 1. PAT scope 확장 (Airtable Web UI, 1회)

1. https://airtable.com/create/tokens 진입
2. 기존 `clavier` PAT 편집 → scopes 에 `webhook:manage` 추가
3. 저장

### Step 2. 워커 라우트 추가 (platform-workers repo)

```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/code/projects/platform-workers/framer-sync
# docs/patches/framer-sync-airtable-webhook.md 보면서 paste:
#  - src/http/routes/airtableWebhook.ts (신규)
#  - src/index.ts 에 라우트 결합 + scheduled handler 추가
#  - wrangler.toml 의 [triggers].crons 추가
```

### Step 3. webhook 등록 (Mac 에서 1회)

```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/scripts
git fetch origin && git checkout claude/airtable-realtime-sync-WkDSe   # 또는 main 머지 후 main

doppler run --project clavier --config prd -- \
  node tools/airtable-webhook-register.mjs register \
    --base appIrjwfcGeVMI9xb \
    --url https://framer-sync.<your-subdomain>.workers.dev/airtable-webhook \
    --table tblXXXXXXXXXXXXXX \
    --include-values all
```

응답에 나오는 `macSecretBase64` + `id` 둘 다 *그 자리에서* Doppler 에 저장 — 두 번 다시 못 봄:

```bash
doppler secrets set --project clavier --config prd \
  AIRTABLE_WEBHOOK_MAC_SECRET_appIrjwfcGeVMI9xb=<base64응답값>

doppler secrets set --project clavier --config prd \
  AIRTABLE_WEBHOOK_IDS='{"appIrjwfcGeVMI9xb":"ach응답값"}'
```

### Step 4. Doppler → wrangler sync + 배포

```bash
bash tools/doppler-sync-wrangler.sh sisoso
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/code/projects/platform-workers/framer-sync
wrangler deploy
```

### Step 5. 검증 (수동)

```bash
# 정상 MAC → 200 기대
node tools/airtable-webhook-verify.mjs ping \
  --url https://framer-sync.<sub>.workers.dev/airtable-webhook \
  --secret $AIRTABLE_WEBHOOK_MAC_SECRET_appIrjwfcGeVMI9xb

# 잘못된 MAC → 403 기대 (HMAC 검증 살아있는지)
node tools/airtable-webhook-verify.mjs ping --url ... --secret ... --bad

# 실 Airtable record 1개 수정 → wrangler tail 에 로그 + framer 반영 확인
wrangler tail
```

### Step 6. clavier-hq 갱신

`docs/decisions/2026-05-13-airtable-realtime-sync.md` 의 SSOT 체크리스트 (12개 문서) 진행. 최소 다음 3개는 필수:
- `DECISIONS.md` — 본 ADR 본문 박기
- `MAP.md` — "이벤트드리븐 흐름" 박스 + "정기 자동화 — 루틴도면" 에 6일 cron
- `SYSTEM_ENV.md` — Doppler 키 3개 등재 (`AIRTABLE_WEBHOOK_MAC_SECRET_<base>`, `AIRTABLE_WEBHOOK_IDS`, 그리고 PAT scope 갱신 메모)

`doc-coverage 'airtable-realtime-sync'` 또는 `doc-coverage --recent` 로 ❌ 0 될 때까지.

---

## 6. 이미 검증된 것 (이 PR 안)

- ✅ HMAC self-test 통과 — `node tools/airtable-webhook-verify.mjs selftest`
  - Node `crypto.createHmac` 와 WebCrypto `subtle.sign` 결과 일치
  - 1바이트 흘리면 MAC 변화 (tamper detect)
  - header prefix `hmac-sha256=` 정상
- ✅ register CLI usage 출력 정상 (`--help`)
- ✅ Airtable Webhooks API 공식 docs 와 시그니처 cross-check (create / payloads / refresh 3 endpoint)

## 7. 아직 검증 안 된 것

- ⏸ 라이브 Airtable webhook 등록 — 이 web 세션에 PAT/Doppler 없음. Mac 에서 Step 3 실행 시 첫 검증.
- ⏸ 워커 라우트가 실제 ping 을 받아 200 반환하는지 — Step 5 ping 으로 검증.
- ⏸ payloads cursor pagination 실데이터 동작 — record 다수 동시 수정 시 mightHaveMore=true 경로.
- ⏸ cron refresh 가 6일마다 도는지 — 6일 후 wrangler log + Airtable webhook expirationTime 확인.

---

## 8. 회귀 방어 & rollback

**회귀 방어 체크리스트** (Step 5 후 추가 검증):

- [ ] `framer push` (전체 sync) 결과와 webhook partial sync 결과의 `stage1_cache` hash 동등성
- [ ] 같은 cursor 로 두 번 호출 → 두 번째 변경 없음 (idempotent)
- [ ] base 당 webhook 10개 한도 안에서 운영
- [ ] webhook expirationTime 잔여일 < 1일이면 closer-runner Step 0 precheck 가 빨간 알림 (이건 routine 측 변경 필요 — 별도 follow-up)

**rollback** (문제 발생 시):

```bash
doppler run --project clavier --config prd -- \
  node tools/airtable-webhook-register.mjs delete --base appXXX --id achXXX
```

워커 라우트 코드는 두고 가도 무해 (ping 이 안 들어옴). 기존 `framer push` 수동 흐름은 영향 없음 — 완전히 독립.

---

## 9. 관련 capability 자동 주입 키워드

다음 키워드 중 하나가 사용자 메시지에 들어오면 hook 가 capability 파일을 자동 컨텍스트에 박음 — 다음 세션이 추측 코드 안 짜게:

`webhook | macSecret | macSecretBase64 | X-Airtable-Content-MAC | hmac-sha256 | changedTablesById | createdRecordsById | changedRecordsById | destroyedRecordIds | webhook:manage | notificationUrl | airtable_webhook_cursor | airtable.*realtime | 실시간.*동기화`

---

## 10. 변경 사항 commits (이 PR 안)

```
133b866 docs(airtable-realtime-sync): platform-workers 워커 라우트 패치 + ADR 초안
80a168f feat(airtable-webhooks): register/verify CLI — Airtable Webhooks API 라이프사이클 + HMAC self-test
22f976c feat(airtable-webhooks): capability doc + UserPromptSubmit auto-inject 등록
```

이 HANDOFF 까지 포함하면 4 commits.

---

## 11. 의문 / 후속 결정 미해결

- **base 당 webhook 한도(10)** vs **여러 table 감시**: 한 webhook 에 `recordChangeScope` 1개라 table 별로 한 개씩 등록하면 10 table 한도. base 전체 감시(scope 생략)로 가면 시끄러움. 현재 sisoso/mukayu 기준 table 수 < 10 이면 table 별 등록 권장.
- **partial sync use case 시그니처**: 기존 `runPartialSync(env, baseId, changedRecordIdsByTable)` 시그니처가 platform-workers 안에 *이미 존재* 한다고 가정한 코드. 만약 use case 가 "전체 sync" 만 노출돼 있다면 use-case layer 에 partial entry 추가 필요 — Clean Architecture 상 HTTP layer 가 직접 store 만지면 안 됨. paste 전 확인.
- **closer-runner Step 0 precheck** 에 webhook 잔여일 < 1일 알림 추가는 별도 PR 권장 (clavier-scripts 측 closer-runner.mjs 변경).
