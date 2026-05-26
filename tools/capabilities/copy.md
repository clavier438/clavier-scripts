# 카피 작업 — Claude 작업 컨텍스트

> 자동 주입: UserPromptSubmit hook (`tools/claude-hooks/user-prompt-submit.config.json` domain=copy)
> 마지막 갱신: 2026-05-26

**raw URL** (외부 LLM 참조용):
`https://raw.githubusercontent.com/clavier438/clavier-scripts/main/tools/capabilities/copy.md`

---

## 한 줄

호텔/브랜드 카피를 **3 도구로 짠다**. 도구는 같은 재료 (Layer 1·2·3 + inputs) 를 다른 출력 채널 (`.md` · CSV · Airtable PATCH) 로 보낸다. 모든 도구는 `tools/lib/copy/` 의 공통 모듈을 거친다 — 한 번 고치면 셋 다 적용.

> 카피 작성 원칙·8단계 워크플로우는 **`airtable-content-workflow.md`** 에 별도 — 사용자가 "○○ 호텔 콘텐츠 만들어" 류 발화 시 그것도 같이 주입됨 (airtable 도메인).

---

## 도구 3개

| 도구 | 입력 | 출력 | 언제 |
|---|---|---|---|
| **copyMd** | 폴더 (.md) + `-i "지시"` | `<folder>/output_v<NN>.md` | 자유 형식 카피 — 웹사이트·브로셔·한 화면 |
| **copyDraft** | 폴더 + `--base <URL>` | `<folder>/<table>.csv` 다발 | Airtable 빈 base 를 배치로 채울 때 |
| **copyDraft** | 폴더 + `--base <URL> --model <URL>` | 같음 | 이미 채워진 reference Airtable 을 모델로 |
| **copyGen** | Airtable record URL | 그 record PATCH | 단일 레코드 다듬기 (인터랙티브) |

**워크플로 순서**:
```
[새 프로젝트]
  copyDraft        →  CSV 다발 ("전부 채워라")
  airtableCtl push →  Airtable 에 올림

[다듬기]
  copyGen          →  레코드 한 개씩 ("이거 다시 써")

[자유 카피]
  copyMd           →  .md 파일 ("웹사이트 카피")
```

---

## 폴더 컨벤션 — 새 프로젝트 시작 시

```
<프로젝트 폴더>/
├── inputs/
│   └── contents.md         ← 시험지 (사실 + IA + 답안 형식)
├── layers/                 ← 옵션. 폴더 우선, 없으면 공통 fallback
│   ├── 1-core/
│   │   └── core.md         ← 채점 기준 (불변 4원칙)
│   └── 2-brand/
│       └── brand.md        ← 모범답안 (이 톤으로 그대로)
└── output_v<NN>.md         ← copyMd 결과 (자동 생성)
└── output_v<NN>.prompt.md  ← 같은 버전. 실제 claude 에 들어간 프롬프트 전문 (감사용)
```

폴더 위치 = 어디든 OK. `~/dev/clavier/works/copy/<프로젝트>/`, iCloud Obsidian, 또는 임의 경로 — 도구는 절대경로 인자만 받는다.

**중요**: 자료는 **반드시 `inputs/` 안에**. 폴더 직속 `.md` (README, 메모, output 잔재) 는 자동 컨텍스트에 안 들어간다. (전 README 가 polluting 컨텍스트 들어가서 톤 망친 사고 있음 → 룰 좁힘.)

---

## 작업 메타포 — "주관식 시험"

| 폴더 | 역할 |
|---|---|
| `inputs/contents.md` | **시험지** — 문제 + 자료 + 답안 형식 |
| `layers/1-core/core.md` | **채점 기준** — 답안이 만족할 원리 (불변) |
| `layers/2-brand/brand.md` | **모범답안** — 이 톤·리듬으로 답안을 쓴다 |
| `-i "..."` | **이번 회차에 푸는 문제** — 즉시 지시 |

---

## 가능 ✅

- `copyMd <folder> -i "지시"` — `.md` 자유 카피 (output_v<NN>.md 자동 증가)
- `copyDraft <folder> --base <URL>` — 빈 Airtable 채움 (CSV)
- `copyDraft <folder> --base <URL> --model <ref-URL>` — 모델 기반 (default mode=ia)
- `copyDraft ... --model-mode ia|ia+content` — IA 만 vs 표현까지
- `copyDraft ... --source live|backup|auto` — airtable-backup GDrive dump 캐시 활용
- `copyDraft ... --refresh-model` — 스키마 hash 갱신 강제
- `copyDraft ... --check-schema` — 스키마 hash 비교만 (cost 절약)
- `copyGen [URL]` — Airtable record 단일 PATCH (인터랙티브 메뉴, `--yolo` = 즉시)
- 매 실행 = `output_v<NN>.md` + `output_v<NN>.prompt.md` 짝 저장 (재현·감사 가능)

## 불가 ❌

| 작업 | 우회 |
|---|---|
| Framer 측 슬롯 자동 생성 | 사용자가 Framer 편집기에서 — 그 후 sync 트리거 |
| 자동 push (Airtable 외) | copyMd 결과 = `.md` 파일. CMS 등 push 는 별도 도구 |
| 멀티 모델 비교 출력 한 번에 | 두 번 실행해 v01/v02 비교 |

---

## 핵심 원리 — 항상 지킬 것

### Layer 1 — 4원칙 (불변)
1. 단어로 결과를 박지 말고, 사실·동사·고유명사·숫자로 흘릴 것
2. 시설·제품을 나열하지 말고, 손님에게 일어나는 일을 적을 것
3. 기본 말투를 유지할 것
4. 모든 문장은 하나의 Big Idea 를 향할 것

### Layer 2 — 톤
- 모범답안 한 단락을 **펜스 없이 명시 라벨과 함께** 박을 것 (예: "이 어체로 그대로 작성합니다")
- 일본어 직역체 X. **자연 한국어** 모범답안 권장
- 어체(존댓말/반말) = 모범답안 어체로 자동 락됨

### 어체 락 — 자동 작동
`tools/lib/copy/domain/tone-lock.mjs` 가 매 요청마다 시스템 프롬프트에 자동 주입.
- 출력 어체 = Layer 2 본문 어체
- `<context>` / instruction 의 어체에 무영향
- 펜스 안의 모범답안도 "이 톤으로 써라" 로 받음 (예시 X)
- 전 "Layer 2 가 존댓말인데 출력이 반말" 사고 해결됨

---

## 코드베이스 구조 (Clean Architecture)

```
tools/lib/copy/
├── domain/                          (외부 무의존)
│   ├── layer-loader.mjs
│   ├── inputs-loader.mjs
│   ├── prompt-builder.mjs
│   └── tone-lock.mjs                ← 어체 락 자동 주입
├── adapters/
│   ├── claude-runner.mjs            ← 트리 echo · 버전 저장 · claude CLI (셋 공통)
│   ├── airtable-source.mjs          ← factory (live/backup/auto) + 스키마 hash 캐시
│   ├── airtable-source-live.mjs
│   └── airtable-source-backup.mjs   ← airtable-backup GDrive dump 읽기
└── use-cases/
    ├── generate-md.mjs              ← copyMd
    ├── generate-from-scratch.mjs    ← copyDraft (--model 없음)
    ├── generate-from-model.mjs      ← 신규 (ia | ia+content)
    └── patch-record.mjs             ← copyGen
```

**5원칙 매핑**:
- SRP — use case 1 = 시나리오 1. adapter 1 = 외부 시스템 1
- OCP — 새 출력 채널 추가 = output adapter 1개. 기존 코드 무변경
- DIP — use case 는 추상에만 의존. live vs backup 교체는 진입점에서 주입
- ISP — copyMd 는 Airtable 어댑터 의존 0. copyGen 은 inputs-loader 안 씀
- 표류 방지 — 어체 락·트리 echo·버전 저장이 한 모듈에만 존재

---

## 모델 기반 생성 — 두 모드

```bash
copyDraft <folder> --base <target-URL>                                  # scratch (빈 base 채움)
copyDraft <folder> --base <target-URL> --model <ref-URL>                # model (default mode=ia)
copyDraft <folder> --base <target-URL> --model <ref-URL> --model-mode ia
copyDraft <folder> --base <target-URL> --model <ref-URL> --model-mode ia+content
```

| 모드 | 무엇을 모범 삼나 |
|---|---|
| `ia` | reference 의 IA 구조만 (테이블·필드·항목 수 결정 로직). 컨텐츠는 새로 짬 |
| `ia+content` | 위에 더해 records 의 표현·문장 길이·정보 밀도까지 few-shot 으로 |

**캐시 전략**:
- `airtable-backup` 의 GDrive dump 가 캐시 본부 (별도 캐시 디렉 X)
- `~/.cache/clavier/copy-model/<baseId>/schema-hash.txt` 에 스키마 hash 저장
- hash 같으면 = 데이터 동일 = 기존 학습 유효 → fetch 비용 절약

---

## 알려진 함정

1. **펜스 안에 모범답안 가두지 말 것.** ` ``` ` 안 모범답안은 Claude 가 "예시" 로 받음 — "이 톤으로 써라" 로 안 받음. 본문에 그대로 박을 것. (어체 락이 펜스 깨지만, 안전하게.)
2. **메타 톤 통일.** 시험지·채점 기준·모범답안 — 세 파일 어체가 일치해야 출력 흔들리지 않음.
3. **폴더 직속 .md 두지 말 것.** 자동 로드 룰에서는 빠지지만 나중 변경·실수로 들어갈 수 있음. inputs/ 안에만 두는 게 안전.
4. **Negative constraint 7개 넘으면 출력이 방어 모드** — 짧고 평면적. positive frame ("이렇게 한다") 으로 쓸 것.

---

## 자주 잘못 알기 쉬운 것

- ❌ "카피 작업은 정해진 폴더 (`works/copy/`) 에서만 가능" → **거짓**. 폴더 위치 무관, 절대경로만 넘기면 됨
- ❌ "copyMd 가 폴더 안 모든 `.md` 자동 로드" → **거짓**. `inputs/*.md` 만. 폴더 직속·templates/ 자동 로드 폐지됨
- ❌ "Layer 2 가 펜스 안이면 톤 안 박힘" → **거짓** (2026-05-26~). 어체 락이 펜스도 깨고 톤으로 적용
- ❌ "output.md 덮어쓰기됨" → **거짓**. `output_v<NN>.md` 다음 빈 번호로 자동 증가

---

## 새 프로젝트 시작 절차

```bash
# 1. 폴더 만들기 (위치 = 임의)
mkdir -p <프로젝트>/inputs <프로젝트>/layers/{1-core,2-brand}
cd <프로젝트>

# 2. 시험지 작성 — inputs/contents.md
#    Big Idea 한 줄 + 사실 목록 + 출제 항목 (섹션·길이·형식)

# 3. 채점 기준 작성 — layers/1-core/core.md
#    Layer 1 4원칙 + 만점/감점 예시 짝
#    (공통 fallback 쓸 거면 skip)

# 4. 모범답안 작성 — layers/2-brand/brand.md
#    자연 한국어 한 단락 (펜스 X) + "이 어체로 그대로 작성합니다" 명시

# 5. 실행
copyMd <프로젝트> -i "룸 섹션만 작성"
# → output_v01.md (카피 본문)
# → output_v01.prompt.md (실제 들어간 system+user 전문, 감사용)
```

---

## 참조

- 실행 코드: `~/dev/clavier/clavier-scripts/tools/copy{Md,Draft,Gen}.mjs`
- 공통 lib: `~/dev/clavier/clavier-scripts/tools/lib/copy/`
- Fallback layers: `~/dev/clavier/clavier-scripts/copy-layers/`
- 카피 작성 원칙·8단계 워크플로우: `capabilities/airtable-content-workflow.md` (airtable 도메인)
- 캐시: `~/.cache/clavier/copyMd.json` · `copyDraft.json` · `copyGen.json` · `copy-model/`

---

## 작업 시작 전 자동 주입 키워드

`카피작업 | 카피 작성 | 카피 다듬 | copy work | copyMd | copyDraft | copyGen | 톤 락 | 어체 락 | 모범답안 | 시험지 (카피) | output_v`
