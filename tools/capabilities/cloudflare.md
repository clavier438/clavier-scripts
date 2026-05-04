# Cloudflare 작업 가능/불가 — Claude 작업 컨텍스트

> 자동 주입: UserPromptSubmit hook (`tools/contextInject.json` domain=cloudflare)
> 마지막 갱신: 2026-05-04

---

## 한 줄

**Cloudflare MCP + REST API + wrangler 3 경로로 거의 모든 운영 가능. 막힘은 *IP whitelist / Node 호환 / ACCOUNT_ID 누락* — 다 사전 점검 가능.**

---

## 가능 ✅

### Cloudflare MCP (`mcp__cb5cd331-...__*`)
- workers: `_list / _get_worker / _get_worker_code`
- D1: `_databases_list / _create / _delete / _query`
- KV: `_namespaces_list / _create / _delete / _update / _get`
- R2: `_buckets_list / _create / _delete / _get`
- accounts: `_list / set_active_account`
- hyperdrive: `_configs_list / _get / _create / _edit / _delete`
- 문서 검색: `_search_cloudflare_documentation`

### REST API (`curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"`)
- `/user/tokens/verify` — 토큰 헬스
- `/accounts/{id}/workers/scripts` — script CRUD
- `/accounts/{id}/d1/database/{db}/query`
- `/zones/{id}/...` — DNS / cache purge / SSL / firewall
- `/accounts/{id}/cfd_tunnel` — tunnel ops

### wrangler (Node 22+ 필요)
- `wrangler deploy --env <name>` (대부분의 worker 작업)
- `wrangler dev` — 로컬 worker 실행
- `wrangler secret put NAME --env <name>` — secret 등록
- `wrangler d1 migrations apply <db> --env <name>`

### GH Actions (자동 deploy)
- `cloudflare/wrangler-action@v3` 사용
- 필요 secret: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (★ ACCOUNT_ID 둘 다 필수)

---

## 불가 ❌ (또는 까다로움)

| 작업 | 우회 방법 |
|---|---|
| token IP whitelist 변경 | 사용자 web UI (My Profile → API Tokens → 토큰 클릭 → Client IP Address Filtering) |
| 결제·플랜 변경 | 사용자 직접 |
| Pages build settings 일부 (build command) | wrangler 또는 web UI |
| 2FA token 발급 | 사용자 직접 |

---

## 시도 전 체크리스트

1. **토큰 헬스**: `curl -sH "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify` → `"status":"active"`
2. **ACCOUNT_ID set**: `echo $CLOUDFLARE_ACCOUNT_ID` → 32자 hex
3. **IP whitelist**: 토큰의 "Client IP Address Filtering" 이 비어있거나 현재 outbound IP 포함. 막혔으면 → 사용자에 IP 알려주고 풀어달라
4. **Node 버전**: `node -v` → v22.x 이상 (wrangler 4.x 요구)
5. **GH Actions secret 둘 다**: `gh secret list --repo <r>` → `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` 둘 다

---

## 잘못 알기 쉬운 것

- ❌ "wrangler 만 가능, MCP 로 D1 query 못함" → **거짓**. MCP `_d1_database_query` 직접 가능.
- ❌ "Account-level token 이면 ACCOUNT_ID 자동" → **거짓**. wrangler env 와 GH workflow env 에 명시 필요. 누락 시 `/memberships 401`.
- ❌ "wrangler Node 16/18/20 다 됨" → **거짓**. wrangler 4.x = Node 22+ 강제.
- ❌ "토큰 발급한 직후엔 IP filter 없음" → **상황별**. 새 토큰 default 가 IP 제한 *있음* 인 경우 있음. 발급 직후 무조건 verify.
- ❌ "wrangler interactive prompt 자동 답하면 됨" → **거짓**. CI/script 에서 interactive prompt 면 멈춤. MCP 또는 REST 우회.

---

## 작업 시작 전 자동 주입 키워드

`cloudflare | 클라우드플레어 | wrangler | worker.*deploy | d1 database | kv namespace | r2 bucket | CLOUDFLARE_API_TOKEN | CLOUDFLARE_ACCOUNT_ID | hyperdrive | cf token`
