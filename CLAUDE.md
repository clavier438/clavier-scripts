# Claude 세션 시작 지침

## 반드시 먼저 할 것

새 세션을 시작하면 **무조건** 아래 순서로 읽어라:

```
1. clavier-hq/SYSTEM_ENV.md → 전체 환경변수·연결 현황 (아키텍트 지도)
2. clavier-hq/STATUS.md     → 현재 모든 시스템 상태
3. clavier-hq/QUEUE.md      → 지금 해야 할 것 (우선순위순)
4. clavier-hq/MISSION.md    → 방향과 기준
```

> SYSTEM_ENV.md 하나로 "어떤 워커가 어떤 Airtable·Framer와 연결돼 있는가"를 즉시 파악한다.
> 이후 대화에서 사용자가 시스템을 다시 설명하지 않아도 된다.

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
4. 일주일 안 catch는 Conductor 책무 #4가 마지막 그물 (Layer 3)

**왜 이 규칙인가**: ADR을 추가하고 다른 문서를 빠뜨리면 의존 작업이 잘못된 가정 위에서 돌아감. 사용자 자리에 없을 때도 자동 보장돼야 함. (CONCEPTS.md "SSOT" + "Defense in Depth" 항목 참조)

추가로, 모든 ADR/개념은 **Notion Architecture Archive**에 매일 03:00 자동 미러됨 (overnight-runner Step 2.5). 사용자가 노션에서 학습용으로 읽음 — Notion 직접 편집 금지.

## 데이터 저장소 규칙 (2026-04-28~)

워커 상태(매핑·해시·config·webhook·sync 결과·Airtable JSON 캐시)는 **D1을 단일 진실 소스**로 운영. KV는 바이너리 캐시 외 사용 금지. 새 워커 추가 시 D1 우선 검토.

framer-sync 표준 D1 테이블: `worker_state`, `collection_items`, `collection_fields`, **`airtable_cache`** (data:{table} 캐시 — 2026-04-28 airtable_cache 도입으로 KV에서 이전). 예외 분류:
- `webp-cache:{id}`는 **R2 버킷으로 이전 완료 (webp-cache KV→R2 이전, 2026-04-30)** — 바이너리는 R2(`framer-sync-webp-cache`), KV write 없음
- health-check-worker처럼 외부 SoT(Airtable system_registry)에 직접 쓰는 워커는 KV/D1 둘 다 미사용

부가: `webExporter/webSiteExporter.py` 의 `webSiteExporter discover_pages` 가 인덱스 페이지네이션 인지(1~3p × detail 3개) 크롤링 지원(2026-04-28).

## platform-workers 클론 규칙 (2026-04-28~)

**`platform-workers` repo의 canonical 로컬 클론은 1개**: `~/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/platform-workers`. 다른 경로(`~/platform-workers`, `~/code/platform-workers`)에 새 클론 만들지 말 것. 이미 있다면 삭제 권유.

**왜**: 동일 repo 다중 클론은 silent drift의 정의적 케이스 (CONCEPTS.md #12 "Cache vs SSOT"). 도구(`doppler-sync-wrangler` 등)도 stale 클론을 가리키면 잘못된 결론을 만듦. DECISIONS.md 2026-04-28 "platform-workers canonical 클론 = iCloud 경로" 참조.

## framer-sync 인터페이스 동결 규칙 (2026-04-28~)

**프레이머가 변화를 알 수 없게 한다.** framer-sync 워커는 Framer 측 스키마를 수정하는 모든 RPC 호출(`addFields`, `createCollection`, `removeFields`)을 호출하지 않는다. `getFields()`로 read-only 조회만 하고, 매칭 안 되는 필드는 `[needs-manual-framer-setup]` 경고 후 graceful skip. Airtable에 새 필드를 추가했는데 Framer 슬롯이 없는 상황을 마주치면 → 워커 코드를 고치려 하지 말고, 사용자에게 "Framer 편집기에서 슬롯 생성하세요" 안내. 그 후 sync 트리거하면 자동 발견. DECISIONS.md 2026-04-28 "framer-sync = '프레이머를 속인다'" 참조.
