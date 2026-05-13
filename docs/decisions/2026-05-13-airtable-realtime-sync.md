# 2026-05-13 — Airtable → Framer 실시간 동기화 (이벤트드리븐)

> ⚠️ **2026-05-13 STALE 부분** — 본 ADR 의 "결정 = 워커가 직접 받는다" 는 *이미 구현돼 있던 사실* 이지 신규 결정이 아님 (baseline 점검: `POST /webhook` 라우트 + cron refresh 5일 이미 동작). 따라서 본 ADR 은 *신규 ADR* 이 아니라 **기존 구현 사후 문서화 + 향상 결정 (HMAC 검증 + partial sync 도입)** 로 재포장 필요. `HANDOFF.md` §"⚠️ 2026-05-13 baseline 점검 후 사실관계 정정" 참조.

> 이 파일은 `clavier-scripts/docs/decisions/` 에 임시 staging.
> 합의 후 `clavier-hq/DECISIONS.md` 에 한 항목으로 정식 박힘 + MAP.md / SYSTEM_ENV.md 동시 갱신.

---

## 결정

Airtable 변경 → framer-sync 워커 즉시 partial-sync. **Cloudflare Worker 가 Airtable Webhook 을 직접 받는다.** OCI VM·ngrok·tunnel 없음.

## 이유

- 워커는 이미 `*.workers.dev` (또는 custom domain) 공인 HTTPS 엔드포인트 → Airtable Webhook 가 직접 도달 가능. 중간 hop 추가하면 장애 표면만 늘어남.
- ngrok/OCI 옵션은 상주 프로세스 +1, secret +2, 새 모니터링 대상 +1 — 워커 안에서 완결되는 흐름에 정당화 안 됨.
- 7일 expire 대응은 cron trigger 1줄로 해결. STL 원칙상 framer-sync 워커가 단일 책임자.

## 거부된 대안

| 대안 | 거부 이유 |
|---|---|
| OCI ngrok 으로 받아 워커 forward | 의미 없는 hop. ngrok URL 변동·VM watch·MAC secret 2 곳 관리. |
| OCI 로 framer-sync 통째 이전 | environment-peer 모델 + STL 원칙과 충돌. 큰 ADR 별도 필요. |
| Airtable Automation → 외부 HTTP | Automation 무료 한도·딜레이·signing 불가능 — 검증 없는 endpoint 노출. |
| Webhook 없이 cron polling 강화 | latency↑, Airtable rate limit 소모, MAP "이벤트드리븐 sync" 명시 요구사항과 불일치. |

## 구현 요약

| Layer | 파일 | repo |
|---|---|---|
| capability doc | `tools/capabilities/airtable-webhooks.md` | clavier-scripts ✅ |
| 등록·해제·갱신 CLI | `tools/airtable-webhook-register.mjs` | clavier-scripts ✅ |
| HMAC self-test + ping smoke | `tools/airtable-webhook-verify.mjs` | clavier-scripts ✅ |
| 워커 라우트 + cron | `framer-sync/src/http/routes/airtableWebhook.ts` 외 | platform-workers (사용자 paste) |
| ADR 정식판 | DECISIONS.md 신규 항목 | clavier-hq (사용자 commit) |
| MAP.md | "정기 자동화 — 루틴도면" 에 6일 cron 추가 + "이벤트드리븐 흐름" 박스 추가 | clavier-hq |
| SYSTEM_ENV.md | Doppler 키 `AIRTABLE_WEBHOOK_MAC_SECRET_<base>` + `AIRTABLE_WEBHOOK_IDS` 등재 | clavier-hq |

## 운영 비용

- 새 상주 프로세스: 0
- 새 secret: base 당 1개 (`AIRTABLE_WEBHOOK_MAC_SECRET_<base>`) + 전체 1개 (`AIRTABLE_WEBHOOK_IDS`)
- 새 cron: 1개 (6일마다 webhook refresh)
- PAT scope 확장: `webhook:manage` 추가 — 1회

## 회귀 방어

- `framer-sync push idempotency self-test` 에 "webhook 1건 in = full sync 와 동등한 stage1_cache hash" 케이스 추가
- closer-runner Step 0 precheck 에 webhook expirationTime 잔여일 < 1 일이면 빨간 알림

## SSOT 갱신 (Layer 1 결정 전파)

다음 12개 표준 문서에 본 ADR 반영 필요 — `doc-coverage 'airtable-realtime-sync'` 실행 후 ❌ 0 될 때까지 다음 작업 시작 금지:

- [ ] DECISIONS.md
- [ ] MAP.md
- [ ] SYSTEM_ENV.md
- [ ] CONCEPTS.md (이벤트드리븐 sync 패턴)
- [ ] STATUS.md
- [ ] QUEUE.md
- [ ] ARCHITECTURE.md (clavier-scripts)
- [ ] capability docs (airtable.md cross-ref → airtable-webhooks.md)
- [ ] PRINCIPLES.md (해당 사항 없으면 skip)
- [ ] routines/closer.md (precheck 추가)
- [ ] CLAUDE.md (필요 시)
- [ ] Notion Architecture Archive (Closer 03:00 자동 미러)
