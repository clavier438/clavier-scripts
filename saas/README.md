# FrameSync SaaS — 멀티테넌트 모듈

> Airtable → Framer 동기화를 **owner(나)** 와 **customer(고객)** 가 *같은 core* 위에서
> 둘 다 프로덕션으로 굴리기 위한 모듈. 사용자의 현재 방식(Doppler 기반 `framer push`)은
> 한 줄도 바뀌지 않는다 — 이 모듈은 위에 *얹는다*.

## 한 줄 정신

**테넌트(누구의 키냐)를 인터페이스 뒤로 숨긴다 → provider 만 갈아끼우면 owner든 customer든 동일 코드.**

CLAUDE.md 의 "framer-sync = platform-agnostic (use case 동일, store 만 D1↔SQLite)" 를
테넌시 축으로 한 번 더 적용한 것. core 는 누구 것인지 모른 채 돈다.

---

## 이 디렉토리 (재사용 모듈)

| 파일 | 책임 | 의존 |
|---|---|---|
| `tenant/tenantConfig.mjs` | TenantConfig 모양 + 검증 + secret 마스킹 | 없음 (순수) |
| `tenant/tenantStore.mjs` | customer 레코드 저장소 (JSON / memory) | fs |
| `tenant/tenantProvider.mjs` | **심장**: owner(Doppler) / customer(store) provider + resolver | `tools/lib/workerEnvMap.mjs` (owner SSOT 재사용) |
| `tenant/ports.mjs` | 모듈 경계 계약 (TenantPort / SyncStorePort / RunnerPort) | 없음 (순수) |
| `tenant/tenantProvider.test.mjs` | 의존성 0 자체 테스트 | node:assert |
| `tenant/customers.example.json` | customer 레코드 스키마 예시 (placeholder) | — |

테스트: `node saas/tenant/tenantProvider.test.mjs` → 5/5

---

## 두 프로덕션, 하나의 core

```
                    ┌──────────────────────────────────────────┐
                    │  core sync  (platform-workers/framer-sync) │
                    │  Airtable → upsert → Framer ManagedColl.   │  ← 한 벌. 불변.
                    └───────────────▲────────────────────────────┘
                                    │ resolve(tenantId) → TenantConfig
                  ┌─────────────────┴──────────────────┐
                  │                                     │
        owner provider (Doppler)            customer provider (store/D1)
                  │                                     │
   ┌──────────────┴───────────┐         ┌───────────────┴──────────────┐
   │ 내 방식 — 그대로          │         │ SaaS — 고객이 키 넣음          │
   │ `framer push` (CLI)       │         │ Cloudflare Worker + webhook   │
   │ Doppler prd / prd_mukayu  │         │ D1 customers 테이블           │
   └───────────────────────────┘         └───────────────────────────────┘
        = 프로덕션 (지금)                       = 프로덕션 (신규)
```

**둘 다 프로덕션**: owner 는 CLI 로, customer 는 multi-tenant Worker 로. 하지만 sync 로직은
한 벌만 존재 — provider 만 다르다. 한쪽 고치면 양쪽 동등성 깨짐(CLAUDE.md "동등성 검증" 규칙 그대로 적용).

---

## 추천 GitHub 구조 — 모노레포 + 패키지

"모든 것이 재사용 가능한 모듈" → npm workspace 모노레포. 각 패키지는 독립 배포/테스트 가능,
서로는 인터페이스로만 안다.

```
framesync/                       (새 repo 또는 platform-workers 안 워크스페이스)
├── package.json                 # workspaces: ["packages/*"]
├── packages/
│   ├── core/                    # @framesync/core — 순수 sync 로직 (platform-agnostic)
│   │   └── src/{sync,upsert,framerClient,airtableClient}.ts
│   ├── tenant/                  # @framesync/tenant — 이 디렉토리가 그대로 승격
│   │   └── src/{tenantConfig,tenantStore,tenantProvider,ports}.mjs
│   ├── store-d1/                # @framesync/store-d1 — SyncStorePort 의 D1 어댑터 (customer)
│   ├── store-sqlite/            # @framesync/store-sqlite — owner 로컬 어댑터
│   ├── worker/                  # @framesync/worker — Cloudflare 엔트리 (customer 프로덕션)
│   │   └── src/index.ts         #   storeTenantProvider(d1) + core
│   └── cli/                     # @framesync/cli — `framer` 명령 (owner 프로덕션)
│       └── src/framer.mjs       #   dopplerTenantProvider + core
└── examples/customers.example.json
```

의존 방향 (안쪽으로만, 클린아키텍처):

```
cli ─┐                         worker ─┐
     ├─► tenant ─► (ports)              ├─► tenant ─► (ports)
     ├─► core                          ├─► core
     └─► store-sqlite                  └─► store-d1
```

- `core` / `tenant` / `ports` 는 **아무것도 import 하지 않는 잎(leaf)** — 가장 재사용성 높음.
- `worker` 와 `cli` 는 **얇은 조립층(composition root)** — 어댑터를 끼워 맞추기만.
- 새 플랫폼(Vercel, OCI 등) 추가 = 새 조립층 패키지 1개. core/tenant 무변화.

### 지금 repo 들과의 매핑 (점진 이행)

현재 코드를 한 번에 옮기지 말 것 (CLAUDE.md "한 번에 하나"). 이행 순서 추천:

1. **지금**: `saas/tenant/` 가 `@framesync/tenant` 의 씨앗. clavier-scripts 안에서 검증.
2. owner CLI(`tools/framer.mjs`)가 `dopplerTenantProvider` 를 *옵션으로* 통과하도록 한 줄 연결 (기존 경로는 fallback 유지 — 무중단).
3. customer Worker 는 platform-workers 에 `store-d1` + `storeTenantProvider` 추가. D1 에 `customers` 테이블 1개.
4. core 가 충분히 안정되면 별도 `framesync` 모노레포로 추출 (선택).

---

## owner 방식이 안 바뀐다는 증거

`dopplerTenantProvider` 는 기존 `tools/lib/workerEnvMap.mjs`(SSOT)를 *재사용*하고,
값은 `doppler run` 이 주입한 `process.env` 에서 읽는다 — `framer.mjs` 와 완전히 동일한 경로.
즉 이 모듈을 안 써도 `framer push` 는 그대로 돌고, 써도 같은 값을 같은 출처에서 읽는다.

---

## 보안

- customer 레코드 = secret (Airtable PAT / Framer token). `customers.json` 은 `.gitignore`.
- 프로덕션 store = D1 컬럼 암호화 또는 Cloudflare Secrets Store. 평문 JSON 은 로컬/PoC 전용.
- 로그에는 `redactTenant()` 거친 것만. raw config 직접 출력 금지.
- owner secret 은 지금처럼 Doppler 가 SSOT. 이 모듈은 owner secret 을 어디에도 복사하지 않음.
