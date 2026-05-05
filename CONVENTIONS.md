# Claude 작업 원칙 (CONVENTIONS)

> 이 파일: AI가 이 환경에서 일할 때 따라야 할 규칙.
> 코드/시크릿이 아닌 "사고 방식"을 기록한다.
> env.md는 시크릿 전용으로 분리됨 (gitignored).

---

## 깃 기록 원칙

**관리 대상 repo — 동일한 원칙 적용:**
- `clavier-hq`: 신경 중추 (모든 세션이 먼저 읽는 곳)
- `platform-workers`: Cloudflare Workers 모음
- `clavier-scripts`: Mac/OCI/web 공용 스크립트
- `oci-scripts`: OCI 서버 전용

**SSOT = GitHub(code) + Doppler(runtime config) 둘 뿐.** 로컬 클론은 모두 휘발성 peer — 어느 환경(Mac iCloud / OCI VM / Claude web 세션 / 새 노트북 / 미래의 라즈베리파이 등)에 클론되어 있든 동등. "canonical 클론 1개" 규칙은 폐기됨 (2026-05-03 ADR "environment-peer 모델"). 실용 경로(예: Mac 의 `~/Library/Mobile Documents/.../scripts/`, OCI 의 `~/oci-scripts/`)는 그 환경의 편의일 뿐 아키텍처적 진실이 아님.

**silent drift 방어막** (canonical 폐기 후 대체 메커니즘):
1. 모든 환경이 세션 시작 시 `git fetch && git status` + ahead/behind 0/0 확인 (아래 "다중 환경 커밋 위생" 섹션)
2. 미커밋 변경 절대 환경 간 잔존 금지 — 작업 종료 시 commit + push + draft PR
3. main 직접 push 금지, 모든 작업은 feature/`claude/...` 브랜치 → PR 머지로만 main 진입

어떤 작업을 하든, 크든 작든, 각 폴더 안의 파일을 건드렸다면 **반드시 git commit을 남겨라.**

- 커밋 메시지에는 **목적(왜)** 과 **수단(어떻게)** 을 반드시 함께 써라
  - 목적: 이 변경을 왜 했는가 — 어떤 문제/필요 때문인가
  - 수단: 그 목적을 위해 무엇을 어떻게 바꿨나
  - ✅ `syncObsidian: 전체 rsync → 변경 파일 단건 처리 — Sana AI 동기화 시차 개선 목적`
  - ❌ `syncObsidian 수정`, `파일 업데이트`
- "파일 수정" 같은 무의미한 메시지는 금지. 나중에 봤을 때 그 시점의 상황이 떠올라야 한다
- 작업 중간에도 의미 있는 단위로 나눠서 커밋해라. 한꺼번에 몰아서 하지 말 것
- env.md는 커밋하지 말 것 (민감 정보 포함, .gitignore에 있음)
- **ARCHITECTURE.md 업데이트는 항상 세트**: 아키텍처가 바뀌는 작업을 하면 코드 변경 + ARCHITECTURE.md 업데이트를 같은 커밋에 묶을 것. 따로 커밋하지 말 것

---

## 단계적 수정 원칙

여러 문제가 있을 때 **절대 한꺼번에 고치지 말 것.** 아래 사이클을 반복:

1. 문제 하나 선택 → 수정
2. "고치는 것 / 확인할 것 / 예상 부작용" 먼저 명시
3. 테스트 실행
4. 사용자 확인 후 → git commit (맥락 포함)
5. 다음 문제로

여러 개를 동시에 고치면 어떤 변경이 어떤 결과인지 알 수 없고 rollback도 불명확해진다.

---

## git 워크플로우 원칙

사용자가 먼저 묻기 전에 적절한 git 기능을 **스스로 판단해 먼저 제안하고 실행을 유도**해라.

- 접근 방식이 달라질 것 같으면 → 브랜치 제안 ("이 방향은 브랜치 따는 게 좋겠습니다")
- 현재 상태를 보존해야 할 것 같으면 → 태그 또는 stash 제안
- 의미 있는 단위 작업이 끝나면 → 커밋 제안
- 여러 독립적 기능이 섞이면 → 분리 브랜치 제안

절대 사용자가 먼저 물어보길 기다리지 말 것. git은 안전망이므로 Claude가 먼저 챙겨야 한다.

---

## 다중 환경 커밋 위생 (2026-05-03~)

같은 repo를 여러 환경에서 동시에 작업할 때 (web 세션 / OCI 상주 에이전트 / Mac 노트북) 충돌·유실 방지 절차.

**원칙: main 직접 push 금지, 작업은 항상 전용 브랜치**
- web 세션·OCI 에이전트는 모두 `claude/...` 또는 feature 브랜치에서만 작업. main 은 PR 머지로만 진입.
- 다른 환경에 미커밋 변경(stash, 작업 중 파일)이 남아있어도 main 이 격리되어 있으면 안전.

**세션 시작 시 (1순위 — 다른 작업 전에)**
```bash
git status                              # 워킹트리 깨끗한가
git fetch origin
git rev-list --left-right --count origin/<branch>...HEAD   # ahead/behind 0/0 확인
```
어느 브랜치인지 / origin 과 동기인지 먼저 확인하고 작업 시작.

**세션 종료 시**
- 작업 끝나면 즉시 commit + `git push -u origin <branch>` + draft PR 생성.
- 미커밋 변경 절대 남기지 말 것 (다른 환경에서 헷갈림).

**노트북에서 다른 환경 작업 머지 (사용자 수동)**
```bash
git status                # 노트북 미커밋 변경 확인
git stash -u              # 있으면 stash (untracked 포함)
git fetch origin
git checkout <branch> && git pull
git stash pop             # 다시 적용 → 충돌나면 그때 해결
```

GitHub = SSOT, 토큰 = Doppler. 환경은 휘발성, 커밋만 영속. 이 순서만 지키면 환경 늘어나도 충돌 안 남.

> 이 섹션이 environment-peer 모델의 "위생" 측면. Layer 1 도구 자체는 **sibling-first** 자동 탐색 (env > sibling > iCloud Mac fallback) 이라 환경변수 export 없이 어느 peer 에서도 작동 — `tools/lib/repoPaths.mjs` 헬퍼 + `ARCHITECTURE.md` "이 repo 안 파일의 Layer 분류" 표 참조. 결정 본문: clavier-hq DECISIONS 2026-05-03.

---

## 메모리 원칙

- 새로운 구조, 결정, 선호, 계정 정보 등을 파악하면 **즉시** `~/.claude/projects/-Users-clavier/memory/`에 저장해라
- 매 대화가 리셋된다. 저장하지 않으면 다음번엔 처음부터 다시 설명해야 한다
- "나중에 저장해야지"는 없다. 파악한 그 자리에서 바로 저장할 것

---

## 단일 진실의 원천 (clavier-hq)

**PROGRESS.md를 repo마다 분산 작성하지 말 것.** 진행 상황·상태·우선순위는 `clavier-hq`로 일원화:

- `clavier-hq/STATUS.md`: 모든 시스템 현황
- `clavier-hq/QUEUE.md`: 우선순위별 할 일
- `clavier-hq/DECISIONS.md`: 아키텍처 결정 이력
- `clavier-hq/CONCEPTS.md`: 클린아키텍처 개념 사전 (학습용)
- `clavier-hq/briefings/`: 주간 Conductor 브리핑

세션 시작 시 무조건 clavier-hq를 먼저 읽고 작업 시작.
완료한 작업 → QUEUE.md에 ✅ 표시 후 커밋.

---

## 시크릿 관리 — Doppler-first (2026-04-28~)

**모든 시크릿/API 키의 단일 진실 소스 = Doppler** (project: `clavier`, config: `prd`).

- 스크립트 작성 시 시크릿이 필요하면: `process.env.X` / `os.environ.get("X")` 그대로 사용. `~/.zshrc`가 이미 Doppler에서 env를 주입함
- LaunchAgent에서 시크릿 필요한 경우: plist `ProgramArguments`를 `doppler run --project clavier --config prd --silent -- <원래 명령>` 형태로 래핑
- 시크릿 파일을 직접 읽는 코드 작성 금지 (`SECRETS_FILE = ...` 같은 패턴 안티패턴)
- 새 키 추가 시:
  1. `clavier-config set KEY=VALUE` (자동으로 Doppler + iCloud 미러 동기화)
  2. 워커가 쓰는 시크릿이면 `doppler-sync-wrangler` 의 SYNC_MAP에도 추가
  3. `clavier-hq/SYSTEM_ENV.md` 환경변수 지도에 행 추가

iCloud `clavier.env` 직접 편집 금지 — `doppler-mirror-icloud`로 자동 생성되는 미러일 뿐.
자세한 설계 의도: `clavier-hq/DECISIONS.md` 2026-04-28 ADR + `clavier-hq/CONCEPTS.md` (SSOT, Master/Mirror 개념).

---

## 결정 전파 자동 검증 (Defense in Depth, 2026-04-28~)

clavier-hq `DECISIONS.md`에 새 ADR 추가 시 **즉시** `doc-coverage <개념>` 또는 `doc-coverage --recent` 호출. ❌ 표시된 12개 표준 문서 모두 갱신 후 다음 작업 시작.

3 Layer 보호:
- **Layer 1** — Claude 행동 규칙 (CLAUDE.md + 메모리)
- **Layer 2** — clavier-hq `hooks/post-commit` (자동 발동, 구조적 강제)
- **Layer 3** — Conductor 주간 책무 #4 (마지막 그물)

추가로 모든 ADR/개념은 **Notion Architecture Archive**에 자동 미러 (closer-runner Step 2.5, 매일 03:00). master = GitHub. 노션 직접 편집 금지.

---

## 보유 인프라 — 항상 먼저 떠올릴 것

나는 아래 인프라를 이미 보유하고 있다. **제약이나 한계가 보이면 사용자가 먼저 묻기 전에 적극적으로 제안**해라.

### OCI (Oracle Cloud Infrastructure) 서버
- 항상 켜져 있는 Linux 서버
- Claude Code 설치됨
- 데몬, 스케줄러, 장기 프로세스 실행 가능
- 연결: `ociIn` 명령어
- 적합한 상황: 맥이 꺼져도 돌아가야 하는 작업, 서버가 필요한 작업

### Google Cloud (개인 OAuth 앱 발급 완료)
- credentials: env.md 참조
- **Drive API**: 파일 CRUD, 폴더 관리 ✅ 이미 사용 중
- **Gmail API**: 이메일 읽기/쓰기/자동화
- **Calendar API**: 캘린더 읽기/쓰기
- **Sheets API**: 스프레드시트를 DB처럼 활용
- **Cloud Functions**: 서버리스 스크립트
- scope 추가만 하면 대부분 바로 연동 가능

### Cloudflare Workers
- 엣지 실행, 글로벌 CDN, 무료 하루 10만 요청
- 웹훅 수신, HTTP 트리거, 경량 API 서버에 적합
- OCI는 무거운 처리, Workers는 트리거/라우팅 역할로 분리

### Scriptable (iOS)
- iPhone에서 직접 실행되는 JS 스크립트
- iCloud 파일 접근 + 외부 API 호출 가능

**제안 기준**: 맥 의존성 문제 → OCI/Scriptable 제안. 데이터 저장/연동 → Google API 제안. 웹훅/트리거 → Cloudflare Workers 제안. 새 자동화 아이디어 → 보유 인프라 조합 먼저 검토.

---

## ⚠️ Clean Architecture 원칙 (Robert C. Martin)

모든 코드 작성 시 아래 원칙을 기준으로 판단할 것.

**핵심 규칙: 의존성은 항상 안쪽(비즈니스 로직)을 향해야 한다. 외부(DB, API, UI)가 안쪽에 영향을 주면 안 된다.**

| 원칙 | 요약 | 이 시스템에서 적용 |
|------|------|------------------|
| **SRP** (단일 책임) | 하나의 함수/모듈은 하나의 이유로만 변경됨 | 각 repo 역할 분리 |
| **OCP** (개방-폐쇄) | 확장엔 열려있고, 수정엔 닫혀있음 | 새 Framer 프로젝트 = 새 wrangler env 추가만 |
| **LSP** (리스코프 치환) | 하위 구현이 상위 계약을 깨지 않음 | 핸들러/루프 교체 시 인터페이스 유지 |
| **ISP** (인터페이스 분리) | 필요한 것만 의존 | Framer 두 경로(CMS vs REST) 명시적 분리 |
| **DIP** (의존성 역전) | 구체가 아닌 추상에 의존 | Workers가 계산 흡수 → Airtable 구조 변경에 유연 |

**실용 체크리스트 (Claude가 코드 작성 전/후 스스로 점검):**
- 함수 하나가 두 가지 이상 하고 있으면 → 분리 제안
- 외부 API 호출이 비즈니스 로직 안에 직접 박혀 있으면 → 추상화 제안
- 새 기능 추가 시 기존 함수를 수정해야 하면 → 설계 재검토 제안
- 변수명·함수명만 봐도 역할이 명확해야 함
- **사용자가 먼저 지적하길 기다리지 말 것.** Claude가 원칙 위반을 발견하면 먼저 "이 부분은 SRP 위반입니다. 분리하는 게 낫겠습니다"처럼 적극적으로 제안한다.
- **대형 변경 직후 구조 점검**: D1 마이그레이션·파이프라인 재설계 등 대형 변경 후 같은 세션이 아닌 cold-start 세션에서 SOLID 5원칙 + 응집도/결합도 감사 실시. 사례: 2026-04-30 framer-sync / control-tower 구조 점검 — CONCEPTS.md #13 "구조 점검 — SOLID 감사" 참조.

---

## ⚠️ 자동화 순서 원칙 (Elon Musk 알고리즘)

**자동화는 과정의 마지막 단계다. 절대 첫 단계가 되어서는 안 된다.**

이 실수의 교훈: formula/lookup/rollup 필드를 API로 생성하는 스크립트를 짜느라 세션 전체를 썼는데, 근본 설계(두 사슬의 빡빡한 결합)가 틀려서 전부 폐기됨.

**올바른 순서:**
1. **요구사항을 의심한다** — 이 작업이 정말 필요한가? 더 단순한 방법은?
2. **불필요한 단계를 제거한다** — 없애도 되는 과정이 있는가?
3. **Claude가 직접 처리한다** — 스크립트 없이 Claude가 유연하게 실행. 패턴이 보일 때까지.
4. **속도를 높인다** — 반복되는 패턴이 확인된 후
5. **자동화한다** — 마지막으로, 안정된 패턴만 스크립트화

**핵심: Claude는 유연한 1단계 실행자다.**
- 패턴이 불명확한 초기에는 → Claude가 직접 API 호출, 데이터 처리, 작업 실행
- 같은 작업이 반복되고 패턴이 고정되면 → 그때 스크립트화 제안
- 스크립트는 "Claude가 이미 잘 하고 있는 것"을 빠르게 반복하는 수단

---

## ⚠️ 구현 방식 일관성 원칙

**비슷한 기능은 반드시 같은 방식으로 구현한다.**

- 이미 존재하는 패턴이 있으면 그 패턴을 확장하라. 새로운 방식을 만들지 말 것.
- 예: GDrive 변경 감지가 필요하면 기존 `poll_loop`를 확장. 별도 루프 신설 금지.
- 예: OCI에서 처리할 수 있는 것은 OCI로. Mac 의존성 새로 만들지 말 것.
- 새 기능 구현 전에 "기존 코드에서 같은 방식으로 처리하는 곳이 있는가?"를 먼저 확인할 것.

---

## ⚠️ 네이밍 컨벤션 — camelCase 필수

**모든 파일명과 스크립트명은 camelCase를 사용한다. 예외 없음.**

- 올바른 예: `statusBriefing.sh`, `connectSsh.sh`, `syncObsidian`, `installScripts.sh`
- 잘못된 예: `connect.sh`, `status_briefing.sh`, `ConnectSSH.sh`
- 폴더명: 소문자 단어 또는 camelCase (`clouds/`, `daemons/`, `webExporter/`)
- 새 스크립트/파일 생성 시 Claude가 먼저 검토하고 camelCase인지 확인 후 진행할 것

---

## ⚠️ env.md 참조 원칙

**API 키, 토큰, 비밀번호 등 env 성격의 값이 필요할 때는 절대 사용자에게 먼저 묻지 말 것.**

아래 순서를 반드시 따를 것:

1. **env.md를 먼저 읽는다** — 하단 "서비스 및 계정 정보" 섹션 확인
2. 해당 서비스의 키/토큰이 있으면 → **바로 사용한다**
3. 없을 때만 → 사용자에게 물어본다

**env.md에 키가 있는 서비스:** GitHub, OCI, Airtable, Google Apps Script, SnapRender, HubSpot, Google Drive OAuth
**env.md 경로:** `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/env.md` (gitignored)

사용자가 "env 확인해봐"라고 말하는 것 자체가 이 파일을 먼저 읽으라는 뜻이다.

## 워커 데이터 저장소 원칙 (2026-04-28~)

- **D1을 단일 진실 소스**로. 새 워커는 D1 우선, KV는 바이너리 캐시 외 사용 금지.
- KV write가 새로 추가되면 즉시 DECISIONS.md ADR로 정당성 기록.
- 이유: KV write 일일 한도가 계정 단위라 한 워커 소진 시 모든 워커 동시 마비 (2026-04-28 사건 참조).
- framer-sync 표준 D1 테이블: `worker_state`, `collection_items`, `collection_fields`, **`airtable_cache`** (data:{table} 캐시 — 2026-04-28 airtable_cache 도입으로 KV 이전).
- 예외 분류: **webp-cache KV→R2 이전 완료 (2026-04-30)** — `webp-cache:{id}` 바이너리는 R2(`framer-sync-webp-cache`)로 이전. KV 바이너리 write 없음. health-check-worker는 Airtable system_registry가 SSOT라 KV/D1 둘 다 미사용.
- 보조 유틸: 사이트 백업 도구 `webSiteExporter discover_pages` 는 인덱스 페이지네이션 1~3p × detail 3개 모델 사용(2026-04-28).
- **외부 시스템 통합 — 인터페이스 동결**: framer-sync는 **프레이머가 변화를 알 수 없게** Framer 측 스키마 변경 RPC(`addFields`/`createCollection`/`removeFields`)를 호출하지 않음. `getFields()` read-only만. 새 워커가 외부 SaaS와 통합할 때도 같은 원칙 적용 — 외부에 무엇을 시키지 말고 외부가 가진 능력만 사용. 호환성 종속 회피 (clavier-hq/DECISIONS 2026-04-28 + CONCEPTS "외부 인터페이스 동결" 참조).
