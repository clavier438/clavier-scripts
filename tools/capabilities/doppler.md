# Doppler CLI 작업 가능/불가 — Claude 작업 컨텍스트

> 자동 주입: UserPromptSubmit hook (`tools/contextInject.json` domain=doppler)
> 마지막 갱신: 2026-05-04

---

## 한 줄

**Doppler = 모든 시크릿의 SoT (project: `clavier`, config: `prd` / `prd_<client>`). iCloud `clavier.env` 는 mirror 에 불과. 새 키는 Doppler 먼저.**

---

## 가능 ✅

### Secret CRUD
- `doppler secrets` — 현재 config 모든 secret list
- `doppler secrets get NAME --plain` — 특정 secret 값
- `doppler secrets set NAME=value` — 추가/갱신
- `doppler secrets delete NAME`
- `doppler secrets download --no-file --format env` — bulk export

### 실행 (★ 권장 패턴)
- `doppler run -- <command>` — env 자동 주입
- `doppler run --command "node script.mjs"` — 동일

### Config 관리
- `doppler configs` — list
- `doppler configs create prd_<client> --project clavier`
- `doppler configs clone --project clavier --config prd --name prd_<client>`
- `doppler configure get config` — 현재 활성 config

### Project 관리
- `doppler projects list / create / delete`

### Auth
- `doppler login` — browser flow (OAuth)
- `doppler whoami` — 현재 사용자/scope
- `doppler logout`

---

## 불가 ❌

| 작업 | 우회 |
|---|---|
| Workplace 멤버 관리 | web UI |
| 결제·플랜 | web UI |
| 2FA 설정 | web UI |
| audit log 직접 export | API token + REST |

---

## 시도 전 체크리스트

1. **로그인 살아있음**: `doppler whoami` → email + workplace 표시
2. **활성 config**: `doppler configure get config` → `prd` 또는 `prd_<client>`
3. **scope**: 새 키 추가 시 해당 config 에 write 권한 (대부분 owner 면 OK)
4. **Mac Keychain**: 토큰 저장됨 — 새 Mac 은 `doppler login` 필수 (1회)

---

## 워크플로 정합성 규칙

새 secret 추가 시 순서:
1. **Doppler 먼저**: `doppler secrets set NEW_KEY=value`
2. **iCloud mirror 자동 sync**: `tools/doppler-mirror-icloud.sh` (cron 또는 수동)
3. **wrangler secret 별도**: `doppler secrets get NEW_KEY --plain | wrangler secret put NEW_KEY --env <name>` — Cloudflare Workers 는 별도 store
4. **GH Actions secret 별도**: `doppler secrets get NEW_KEY --plain | gh secret set NEW_KEY --repo <r>` — Actions 는 또 별도

→ **3개 store 동기화** (Doppler / wrangler / GH secrets) 가 자주 누락됨. precheck 가 검증.

---

## 잘못 알기 쉬운 것

- ❌ "iCloud env 와 Doppler 동시 갱신" → **거짓**. Doppler 가 SoT. iCloud 는 mirror.
- ❌ "Doppler 에 set 하면 worker 즉시 적용" → **거짓**. wrangler secret put 또는 redeploy 필요.
- ❌ "Doppler 에 set 하면 GH Actions 도 자동" → **거짓**. `gh secret set` 별도.
- ❌ "한 토큰으로 모든 config 접근" → **거짓**. config 별 scope 가능.

---

## 작업 시작 전 자동 주입 키워드

`doppler | doppler.*config | doppler.*secret | doppler run | DOPPLER_TOKEN`
