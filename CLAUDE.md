# Claude 세션 시작 지침

## 반드시 먼저 할 것

새 세션을 시작하면 **무조건** 아래 순서로 읽어라:

```
1. clavier-hq/MAP.md        → 시스템 도면 (구조 한눈에) ★
2. clavier-hq/SYSTEM_ENV.md → 환경변수·연결 현황 (URL, KV ID 등)
3. clavier-hq/STATUS.md     → 현재 시스템 상태
4. clavier-hq/QUEUE.md      → 지금 해야 할 것 (우선순위순)
5. clavier-hq/MISSION.md    → 방향과 기준
```

> **MAP.md** 가 진짜 "한 화면 도면". 의존성 방향, 흐름, 변동성 적응 메커니즘이 전부 거기.
> SYSTEM_ENV.md 는 데이터 (URL, KV ID, Doppler 키 목록).

## 살아있는 도면 우선 원칙 (2026-05-10~) ★ 절대 원칙

**현상태를 알려주는 도면 = 항상 최신**. 어긋남 발견 시 *그 즉시* 갱신.

사용자 발화 (2026-05-10): *"현상태를 알려주는 도면을 항상 최신버전으로 가지고 있도록 하고, 그게 틀린거 발견했으면 매번 최신화"*

### 살아있는 도면 (clavier-hq)

| 도면 | 갱신 방식 | 어긋남 시 |
|---|---|---|
| MAP.md | 수동 — 구조 변경한 사람 | 즉시 같은 commit |
| STATUS.md | 수동 — 상태 변경한 사람 | 즉시 |
| SYSTEM_ENV.md | 수동 — 환경 변경한 사람 | 즉시 |
| routines/*.md | 수동 — routine 책임자 | 즉시 |
| WORKER_STATUS.md | 자동 (workerCtl conduct) | 다음 conduct |
| CATALOG.md | 자동 (Engineer 일요일) | 다음 일요일 |
| SENTINEL_AUDIT.md | 자동 (Sentinel 매일) | 다음 새벽 |
| PRINCIPLES.md | 수동 (Ray Dalio 매일) | 다음 새벽 |

분류 표 master = `clavier-hq/MAP.md` "살아있는 도면 — 원칙 + 책임 분류" 섹션.

### Claude 행동 규칙

작업 중 도면과 실제가 어긋남을 발견하면:
1. **현재 작업 멈춤**.
2. 도면 먼저 갱신 + commit (1줄이라도).
3. 그 다음 원래 작업 재개.

이유: 도면 갱신 미루면 그 commit 에 어긋남이 묻혀 다음 사람/Claude 가 거짓 위에서 추리 → cascading drift.

### 구조 변경 시 동시 갱신 (Defense in Depth)

**구조가 바뀌면 MAP.md 도 같은 commit 에 포함**:
- 워커 추가/삭제 → 노드 수, SSOT 박스
- 새 layer / 폴더 → 의존성 트리
- 새 흐름 (route, cron, queue) → 흐름 시나리오
- 새 외부 SSOT 키 → Doppler 박스
- 새 외부 변동성 처리 → 적응 표
- 새 routine / 시간 슬롯 변경 → "정기 자동화 — 루틴도면" 섹션

매 commit 메시지에 영향 받은 도면 영역 명시.

GitHub: https://github.com/clavier0/clavier-hq

그 다음 이 repo에서:
1. `CONVENTIONS.md` — 작업 원칙 (Clean Architecture, Git, 메모리, 단계적 수정 등)
2. `ARCHITECTURE.md` — Mac 자동화 모듈 구조
3. `env.md` — 시크릿/계정 키 목록 (실제 값은 Doppler에 있음)

## 핵심 원칙 (요약)

- 모든 파일 변경 → git commit (목적 + 수단 명시)
- 문제 하나씩 고치기 (여러 개 동시 수정 금지)
- 완료한 작업 → clavier-hq/QUEUE.md에 ✅ 표시 후 커밋
- 클린아키텍처 위반 발견 시 적극 시정 제안
- **대형 변경(D1 마이그레이션·파이프라인 재설계 등) 직후**: cold-start 세션에서 SOLID 감사 실시 — CONCEPTS.md #13 "구조 점검" + DECISIONS.md 2026-04-30 "framer-sync / control-tower 구조 점검" 참조
- 자세한 가이드는 CONVENTIONS.md 참조

## framer-sync 로컬 운영 (2026-05-01~)

framer-sync 가 platform-agnostic 으로 추상화됨 — Cloudflare/Mac/OCI 동일 코드. 사용자 일상 운영은 **Mac 의 `framer` 명령** 한 단어:

```bash
framer push          # Layer 1+2 한방 (Airtable → SQLite → Framer)
framer status        # 한눈 확인
framer rows <col>    # SQLite 들여다보기 (디버그)
framer help          # 전체 명령
```

`framer` 는 `~/bin/framer` symlink → `scripts/tools/framer.mjs` (canonical iCloud). workerCtl(Cloudflare 측) 의 Mac-local 짝.

**대형 변경 시 하지 말 것**: `framer` 가 호출하는 코드는 Cloudflare worker 와 단 한 줄도 안 다름 (use case 동일, store 인터페이스만 D1 ↔ SQLite). 한쪽만 고치면 동등성이 깨짐. 동등성 검증 = `framer push` 실행 후 stage1_cache hash 비교 (Tier 2). DECISIONS 2026-05-01 "framer-sync = platform-agnostic" 참조.

새 Mac 자동 복구: `bash setup.sh` 한 번 + `doppler login` 1번. setup.sh 가 node·jq·doppler·framer·npm install 까지 자동.

## 시크릿 사용 규칙 (2026-04-28~)

**단일 진실 소스 = Doppler** (project: `clavier`, config: `prd`).

스크립트·명령 실행 시:
```bash
doppler run -- <명령>     # 환경변수 자동 주입
doppler secrets            # 현황 확인
doppler secrets set K=V    # 값 변경 (Doppler 먼저)
```

iCloud `clavier.env`는 **백업 미러**. 값 다르면 Doppler가 정답.
새 키 추가는 **Doppler에 먼저**, 그 다음 미러로 전파.

## 시스템 일관성 규칙 — 결정 전파 (Layer 1, 2026-04-28~)

**아키텍처 결정(ADR)은 시스템 전체 문서에 즉시 반영돼야 한다.**

`clavier-hq/DECISIONS.md`에 새 ADR을 추가하면:
1. **즉시** `doc-coverage <개념>` 또는 `doc-coverage --recent` 실행
2. 12개 표준 문서 중 ❌ 표시된 곳을 모두 갱신할 때까지 다음 작업 시작 금지
3. clavier-hq commit 시 post-commit 훅이 자동 재검증 (Layer 2 백업)
4. 일주일 안 catch는 Architect 책무 #4가 마지막 그물 (Layer 3)

**왜 이 규칙인가**: ADR을 추가하고 다른 문서를 빠뜨리면 의존 작업이 잘못된 가정 위에서 돌아감. 사용자 자리에 없을 때도 자동 보장돼야 함. (CONCEPTS.md "SSOT" + "Defense in Depth" 항목 참조)

추가로, 모든 ADR/개념은 **Notion Architecture Archive**에 매일 03:00 자동 미러됨 (closer-runner Step 2.5). 사용자가 노션에서 학습용으로 읽음 — Notion 직접 편집 금지.

## 데이터 저장소 규칙 (2026-04-28~)

워커 상태(매핑·해시·config·webhook·sync 결과·Airtable JSON 캐시)는 **D1을 단일 진실 소스**로 운영. KV는 바이너리 캐시 외 사용 금지. 새 워커 추가 시 D1 우선 검토.

framer-sync 표준 D1 테이블: `worker_state`, `collection_items`, `collection_fields`, **`airtable_cache`** (data:{table} 캐시 — 2026-04-28 airtable_cache 도입으로 KV에서 이전). 예외 분류:
- `webp-cache:{id}`는 **R2 버킷으로 이전 완료 (webp-cache KV→R2 이전, 2026-04-30)** — 바이너리는 R2(`framer-sync-webp-cache`), KV write 없음
- health-check-worker처럼 외부 SoT(Airtable system_registry)에 직접 쓰는 워커는 KV/D1 둘 다 미사용

부가: `webExporter/webSiteExporter.py` 의 `webSiteExporter discover_pages` 가 인덱스 페이지네이션 인지(1~3p × detail 3개) 크롤링 지원(2026-04-28).

## environment-peer 모델 (2026-05-03~, 이전 "canonical 클론" 규칙 폐기)

**SSOT = GitHub(code) + Doppler(runtime config) 둘 뿐.** 어느 환경(Mac iCloud / OCI VM / Claude web / 새 노트북 / 미래 서버)에 클론되어 있든 동등한 peer. 특정 경로를 "canonical" 로 지정하지 않음.

**왜 폐기했나**: OCI 상주 에이전트 + 다중 환경 운영(CONVENTIONS "다중 환경 커밋 위생") 시 "canonical 1개" 가정이 환경 확장을 가로막음. 진짜 SSOT 는 외부(GitHub/Doppler)에 있으므로 로컬 클론은 모두 휘발성 캐시. silent drift 방어는 "canonical 강제" 가 아니라 "모든 환경이 시작 시 fetch+status, 종료 시 commit+push" 로 대체. DECISIONS.md 2026-05-03 ADR "environment-peer 모델" 참조.

**실용 경로** (편의일 뿐, 강제 아님):
- Mac: `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/`, `.../0/code/projects/platform-workers/`
- OCI: `~/oci-scripts/`, `~/clavier-scripts/`, `~/platform-workers/` on `ubuntu@168.107.63.94`
- web (Claude Code on web): 세션 워크디렉토리, 휘발성

**sibling-first 자동 탐색 (2026-05-03~)**: Layer 1 도구는 관련 repo 위치를 ① env override → ② sibling 디렉토리(`$REPO_ROOT/../<name>`) → ③ Mac iCloud 관례 fallback 순으로 찾음. 헬퍼: `tools/lib/repoPaths.mjs` (.mjs) / inline (.sh). OCI 부트는 `clavier-scripts`/`clavier-hq`/`platform-workers` 를 형제로 clone — zero-config. ARCHITECTURE.md "이 repo 안 파일의 Layer 분류" 표 참조.

## Airtable Scripting 작업 시작 전 (2026-05-05~) ★ 강제

Airtable Scripting Extension 작업 시 — **`capabilities/airtable-scripting.md` 자동 주입**됨 (UserPromptSubmit hook). 거기에 Table 클래스 / Field options / createFieldAsync 의 정확한 시그니처 (Airtable/blocks SDK source 매일 mirror).

원본 source 위치: **`docs/airtable-blocks-sdk/`** (매일 03:00 Closer fetch — `CLOSER_QUEUE.md` "매일 자동 실행 (영구)" 항목, 스크립트 = `tools/airtable-scripting-docs-fetch.sh`).

규칙:
- 새 메서드 사용 전 → `docs/airtable-blocks-sdk/src/models/table.ts` 등 raw 파일 grep. 추측 금지.
- `getFieldByNameIfExists` 같은 SDK 메서드도 *Scripting 환경 노출 안 됨* 가능성. 안전 패턴 = `tbl.fields.find(f => f.name === ...)`
- 사용자 시도 결과 = truth (community 답변·docs 와 충돌 시 사용자 시도 우선)
- 추측 단정 발생 → RAY_DALIO_QUEUE 큐에 박음 (다음 새벽 강제 hook 추가)

## PRINCIPLES.md 자동 인지 (2026-05-05~) ★ 살아있는 원칙

**`clavier-hq/PRINCIPLES.md` = Ray Dalio 가 매일 누적하는 원칙 문서**. 사용자가 가장 자주 보는 *살아있는 baseline*.

새 세션 시작 시 또는 작업 중 의문 발생 시 *반드시 먼저* 참조. 거기 박힌 원칙은 *어쩔 수 없이 지켜질 수밖에 없는 구조* 위에 박힘 (강제 hook 4 layer 동반). 위반 시 자동 감지 → Ray Dalio 가 다음 새벽 강화.

## Ray Dalio 큐 박는 패턴 (2026-05-05~) ★ 강제

**사용자 발화 트리거**:
- "이거 Ray Dalio 한테 보고"
- "이거 실수다"
- "이런 거 다시 일어나면 안 돼"
- "왜 이런 일이 또 일어나"
- "도면이랑 다른데" / "이거 도면이랑 어긋나" / "왜 도면 안 박혔어" (→ 살아있는 도면 우선 원칙 위반)

→ 즉시 `clavier-hq/RAY_DALIO_QUEUE.md` 의 `## 대기 중` 섹션에 미체크 항목 (`- [ ]`) 으로 박음. 형식 ([RAY_DALIO_QUEUE.md 의 "형식" 섹션](https://github.com/clavier0/clavier-hq/blob/main/RAY_DALIO_QUEUE.md) 참조):

```
- [ ] YYYY-MM-DD 실수: <한 줄>
  - **사실관계**: ...
  - **사용자 발견 경위**: ...
  - **즉시 영향**: ...
  - **5 whys 자기 진단**: ...
  - **요청 사항** (선택): ...
```

박은 후 commit + push (clavier-hq 만). **즉시 처리 X** — Ray Dalio 가 다음 새벽 03:30 일괄 처리. Claude 자체는 *해결 시도 X*, 박기만.

## STL 원칙 (Single-Threaded Leader, 2026-05-04~) ★ 절대 원칙

**모든 자동화 = 단일 책임 루틴 + 익명 부하** 구조. 어떤 자동화도 *책임지는 루틴 없이* 떠돌면 안 됨.

규칙:
1. **루틴** = 한 영역 단일 책임자. 사용자가 이름을 안다. 현재 5 cron-등록 (clavier-hq/routines/): Closer (매일 03:00) / Ray Dalio (매일 03:30) / Sentinel (매일 03:45) / Engineer (주 일 03:30) / Architect (주 월 04:30). + Strategist 는 ad-hoc (cron 없음).
2. **부하** = 루틴이 임명. 한 루틴 종속. 사용자에 직접 메시지 X.
3. 사용자와 직접 대화하는 entity = 오직 루틴. 부하 결과는 루틴이 통합 → 1 briefing.
4. 무소속 자동화 금지 — 새 prompt 작성 시 어느 루틴의 부하인지 먼저 명시.

**Claude 행동 규칙**:
- 새 자동화·prompt 추가 시 → 헤더에 *소속 루틴* 명시. 없으면 작성 금지 (사용자에 어느 루틴 부하인지 합의 받기).
- 부하 prompt 작성 시 → "사용자 직접 메시지 금지. raw 보고만 → 루틴이 통합" 헤더에 박음.
- 무소속 prompt 발견 시 → archive 권고 또는 새 루틴 합의 제안.

위반 시 사용자 폭발 (2026-05-04 인용): "*책임지는 새끼 없이 오합지졸로 떠돌아다녀서 잘하고있는지 확인조차 있는지없는지도몰랐다*". DECISIONS.md 2026-05-04 ADR "STL 원칙 + Closer 신설" 참조.

## 능력 떠넘기기 전 self-check (2026-05-04~, B1 병목 차단)

**"사용자가 직접 하셔야 합니다" 발화 전 반드시 self-check.** 어제 이 패턴으로 사용자가 폭발 — 사실 Claude 가 직접 가능했던 것을 떠넘김.

체크 순서:
1. `tools/capabilities/{도구}.md` 가 자동 주입됐는지 (UserPromptSubmit hook). 안 됐으면 키워드 매칭 안 된 것 — Read 직접.
2. 그 파일의 "잘못 알기 쉬운 것" + "가능 ✅" 표 확인.
3. 가능한데 시도 안 한 것 있으면 **먼저 시도** 후 실패해야 떠넘김.

특히 자주 *거짓 떠넘김*:
- "GH Actions secret 은 web UI 에서만" → `gh secret set NAME --body ... --repo o/r` 한 줄
- "wrangler 로만 가능" → Cloudflare MCP 도 됨
- "Cloudflare token IP 검증 못함" → `curl /user/tokens/verify` 자동
- "Doppler·wrangler·GH secret 동기화는 사용자가" → 3 곳 자동 sync 가능

**Defense in Depth (B1~B5 병목 차단)**:
- L1 인식 — `tools/capabilities/*.md` (airtable/github/cloudflare/framer/doppler) + UserPromptSubmit auto-inject
- L2 차단 — `tools/precheck.sh <tool>` 작업 시작 전 1회
- L3 회귀 — framer-sync push idempotency self-test
- L4 새벽 감독 — closer-runner Step 0 = morning shield (매일 03:00 `precheck all` → red dot 시 macOS 알림)

DECISIONS.md 2026-05-04 "B1~B5 병목 4 layer 차단" 참조.

## framer-sync 인터페이스 동결 규칙 (2026-04-28~)

**프레이머가 변화를 알 수 없게 한다.** framer-sync 워커는 Framer 측 스키마를 수정하는 모든 RPC 호출(`addFields`, `createCollection`, `removeFields`)을 호출하지 않는다. `getFields()`로 read-only 조회만 하고, 매칭 안 되는 필드는 `[needs-manual-framer-setup]` 경고 후 graceful skip. Airtable에 새 필드를 추가했는데 Framer 슬롯이 없는 상황을 마주치면 → 워커 코드를 고치려 하지 말고, 사용자에게 "Framer 편집기에서 슬롯 생성하세요" 안내. 그 후 sync 트리거하면 자동 발견. DECISIONS.md 2026-04-28 "framer-sync = '프레이머를 속인다'" 참조.
