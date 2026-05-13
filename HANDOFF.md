# Handoff — Airtable → Framer 실시간 이벤트드리븐 sync

> 다음 세션 cold-start 가 이 한 페이지만 읽어도 작업 이어받을 수 있게.
> 마지막 갱신: 2026-05-13

---

## 한 줄 (현재 상태)

**Airtable → D1 까지는 webhook 으로 자동.** Airtable 변경 ping → 워커 `POST /webhook` ingest → `runStage1` 으로 D1 캐시 갱신. cron 5일 refresh 살아있고, sisoso/mukayu 둘 다 검증됨 (lastSync 어제오늘).

**D1 → Framer 적용** 은 두 모드 지원 (platform-workers PR #2 머지 후):
- `stage1-only` (default) — Framer 적용은 명시 트리거 (`/push-managed` 또는 `framer push`)
- `full` — 큐 init 자동 박혀 매분 cron 가 단계 진행 → Framer 까지 자동

토글 = workerCtl 의 *Webhook 모드 토글* 메뉴 (capability-driven 자동 노출, 코드 변경 X).

---

## 작업 위치 분포

| repo | 역할 | 현재 상태 |
|---|---|---|
| `clavier438/clavier-scripts` (이곳) | Mac 도구함 — workerCtl, capability, register/verify CLI | PR #5/#7 머지됨 |
| `clavier438/platform-workers` | framer-sync 워커 본체 (Cloudflare 운영 SoT) | PR #2 (webhook 모드 토글) 머지됨 — `wrangler deploy` 별도 |
| `clavier438/clavier-hq` | DECISIONS / MAP / SYSTEM_ENV (시스템 SSOT 문서) | 본 ADR 정식 이동 대기 |
| Doppler `clavier`/`prd` | secret SSOT | `webhook:mode` D1 키는 워커 측 (Doppler 무관) |

---

## 핵심 파일 맵 (현재 main)

| 파일 | 역할 |
|---|---|
| `tools/capabilities/airtable-webhooks.md` | Airtable Webhooks API 시그니처 + 함정 8개 (자동 주입 capability) |
| `tools/airtable-webhook-register.mjs` | register/list/delete/refresh/payloads CLI (디버그·감사용) |
| `tools/airtable-webhook-verify.mjs` | HMAC self-test + 라이브 ping (정상/잘못 MAC) |
| `docs/decisions/2026-05-13-airtable-realtime-sync.md` | ADR — STALE 박스 박힘. 향상 결정 (HMAC + partial sync) 부분 살아있음 |
| `docs/patches/framer-sync-airtable-webhook.md` | 워커 측 향상 가이드 (paste 가이드 X) — HMAC + partial sync 도입 명세 |

---

## 향상 후속 (남은 진짜 가치)

1. **HMAC 검증 추가** — 현재 `POST /webhook` 라우트엔 `X-Airtable-Content-MAC` 미검증 (forge 가능). 워커 측 `routes/configure.ts handleWebhook` 에 WebCrypto importKey HMAC-SHA256 + timing-safe compare 추가.
2. **partial sync** — 현재 `runStage1` 은 전체 Airtable→D1. payloads cursor 의 `changedRecordIds` 만 처리하면 더 빠름. `usecases/stage1.ts` 에 partial entry point.
3. **closer-runner Step 0 precheck** — webhook 잔여일 < 1일이면 macOS 알림 (현재 cron 5일 refresh 라 안전마진 충분, 단 cron 자체 죽으면 7일 expire 후 사고).

---

## 미해결 의문

- base 당 webhook 10개 한도 vs table 별 등록 전략 — 현재 base 전체 1 webhook (현 sisoso/mukayu 둘 다)
- partial sync 도입 시 기존 stage1 use case 시그니처 어떻게 분기

---

## 정리된 잔재 (이번 PR 외)

- PR #5 + PR #7 + PR #2 머지됨 (위 표 참조)
- PR #6 (옛 handoff) 는 conflict 로 닫힘 — 본 PR 이 그것의 대체
