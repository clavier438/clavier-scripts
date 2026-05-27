# 카피 작업 — Claude 작업 컨텍스트

> 자동 주입: UserPromptSubmit hook (`tools/claude-hooks/user-prompt-submit.config.json` domain=copy)
> 마지막 갱신: 2026-05-26 (3 도구 → 단일 `copy` 통합)

**raw URL** (외부 LLM 참조용):
`https://raw.githubusercontent.com/clavier438/clavier-scripts/main/tools/capabilities/copy.md`

---

## 한 줄

호텔/브랜드 카피를 **`copy` 한 도구로 짠다**. 폴더 안 `input/<숫자>/*.md` 만 순서대로 concat → claude → `output/`. md 모드 / airtable 모드는 인자만 다름.

> 카피 작성 원칙·8단계 워크플로우는 **`airtable-content-workflow.md`** 에 별도 — 사용자가 "○○ 호텔 콘텐츠 만들어" 류 발화 시 그것도 같이 주입됨 (airtable 도메인).

---

## 정신 (사용자 발화 2026-05-26)

> "스크립트는 단지 순서대로 합치는 것 뿐. 폴더 안에 뭘 넣든 몇 개 폴더든 사용자 사정."
> "하드코딩이 아니라 폴더로 (SvelteKit 정신)."
> "system 슬롯 폐기 — 전부 user 로. 사용자가 폴더에 '너는 ...' 박으면 그게 시스템 역할."

**코드는 모름**. Layer 1·2·3 슬롯, 어체 락, system head, 모범답안 마킹 — 전부 사용자가 폴더 안 `.md` 로 표현. 도구는 cat.

관련 메모리: `feedback_folder_is_meaning.md`, `feedback_no_system_slot.md`.

---

## 스크립트 매커니즘

`copy.mjs` = concat 엔진 뿐. Layer 개념·슬롯·분기는 코드에 없음.

```
input/<숫자>/*.md  자연수 폴더순 + 알파벳 파일순
                   └→ \n\n concat
                      (--ref)    Airtable records 이어붙임
                      (--target) Airtable schema 이어붙임
                      (-i)       <instruction> 태그로 끝에
                   └→ claude CLI (--system-prompt X, 전부 user 로)
                   └→ output_v<NN>.md          ← 결과물
                      output_v<NN>.prompt.md   ← 실제 들어간 프롬프트 (감사·재현)
```

버전 자동 증가, 덮어쓰기 없음. `_` 접두사 `.md` 무시 (사용자 메모용).

---

## 버전 진화

| 버전 | 도구 | 레이어 | 핵심 변화 |
|---|---|---|---|
| 1.0.0 | `gen.sh` (bash) | 2 (core + brand) | 시소소 전용. system/user 분리. 경로 하드코딩 |
| 2.0.0 | 수동 블록 | 2 (Brand Voice + task) | 단순화 시도 |
| 3.0.0 | `copyMd.mjs` | 3 (core / brand / contents) | **폴더 기반 최초 도입** |
| 4.0.0 | `copyMd.mjs` | 3 (Foundation / Context / Execution) | Self-review 체크리스트 추가 |
| anthropic4layer (5.0.0) | `copy.mjs` | 4 (Anthropic 공식) | Role·Input·Thinking·Output. **system 슬롯 완전 폐기** |

**도구 흐름**: `gen.sh` → `copyMd.mjs` → `copy.mjs` (md + airtable 통합, 2026-05-26~)

---

## 폴더 컨벤션

```
<프로젝트 폴더>/
├── README.md     ← 사람용. 도구 무시.
├── input/
│   ├── 1/        ← 이름이 자연수인 폴더만 봄
│   │   └── *.md  ← 한 폴더 안에 .md 자유 (사용자 컨벤션은 1개)
│   ├── 2/
│   ├── 3/
│   └── ...       ← 그 외 (input/foo.md, input/extra/) 모두 무시
└── output/       ← output_v<NN>.md + output_v<NN>.prompt.md (자동 생성)
```

폴더 위치 = 어디든 OK. 사용자 실위치: **`~/projects/tests/<프로젝트>/`** (symlink → `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/projects/tests/`, iPhone Obsidian 과 sync). 절대경로/`~` 시작 인자만 받음.

**input/ 안 정렬 규칙** (사용자 결정 2026-05-26):
- `input/` 직속 자식 중 **이름이 자연수인 폴더만** 처리. 자연수순 (`1` → `2` → `10` → `11`).
- 각 숫자 폴더 안 `.md` 알파벳순. **하위 폴더 재귀 안 함**.
- **`_` 접두사 `.md` 무시** (예: `_readme.md`, `_notes.md`) — 사용자 설명·메모용. 같은 폴더에 두면 작업 편한데 프롬프트 오염 X.
- `input/` 직속 `.md`, 비-숫자 폴더 (`templates/`, `_meta/` 등) 모두 무시.
- 순수 `\n\n` concat. **파일명·폴더명 헤딩 안 박힘**. 파일명은 사용자 보관·분류용 (버전·태그 자유), LLM 한테는 안 전달.

`output/` 안 `output_v<NN>.md` 의 NN 은 기존 max + 1 자동 증가. 덮어쓰기 X.

---

## 인자 매트릭스

```bash
copy                                       # 폴더 메뉴 → md 모드
copy <folder>                              # md 모드 (input/ → output/)
copy <folder> -i "지시"                    # md 모드 + 자유 명령
copy <folder> --target <URL>               # airtable 모드 (인터랙티브 메뉴)
copy <folder> --target <URL> -i "지시"     # airtable 즉시 실행
copy <folder> --ref <URL> --target <URL>   # airtable + reference
copy <folder> --target <URL> --ref <URL> -i "..."  # 풀 자동
```

**모드 분기**:
- `--target` 없음 → **md 모드**. 응답은 마크다운 본문 → `output_v<NN>.md`.
- `--target` 있음 → **airtable 모드**.
  - URL 에 `rec...` 포함 → 단일 record PATCH.
  - URL 에 `rec...` 없음 → base 통째 (다중 테이블 create-or-patch, 10개 batch).

**인터랙티브**:
- `--target` 만 박고 `-i` 없으면 → readline 메뉴로 ref / instruction 차례로 묻기 → 확인 → 실행.
- 인자 다 박으면 메뉴 없이 바로 실행.

---

## 동작

1. `input/` 안 숫자 이름 폴더만 자연수순 → 각 폴더 안 `.md` 알파벳순 → `\n\n` concat (헤딩 없음).
2. `--ref` 있으면: 그 Airtable 의 schema + 모든 records fetch → `<reference-airtable>` 태그로 감싸 위에 이어붙임.
3. `--target` 있으면: 그 Airtable schema fetch → `<target-airtable>` 태그로 이어붙임 + JSON 형식 안내 자동 첨부 (record vs base 모드별).
4. `-i` 있으면: `<instruction>` 태그로 끝에 첨부.
5. `claude` CLI spawn — **`--system-prompt` 인자 미사용**. 모든 텍스트 stdin (user) 으로.
6. 모드별 결과:
   - md → 응답 본문 (펜스 strip 후) → `output_v<NN>.md`.
   - airtable record → JSON 파싱 → 그 record PATCH.
   - airtable base → JSON 파싱 → `{ "테이블명": [...records...] }` → 테이블별 create/patch.
7. 모든 모드: 실제 들어간 user prompt 전문을 `output_v<NN>.prompt.md` 에 저장 (재현·감사).
8. cache `~/.cache/clavier/copy.json` 에 최근 폴더 누적 (최대 10개).

---

## 가능 ✅

- `copy <folder>` — md 자유 카피
- `copy <folder> -i "..."` — md + 즉시 지시
- `copy <folder> --target <URL>` — airtable 모드 인터랙티브 (ref / -i 차례로 묻기)
- `copy <folder> --target <record-URL>` — 단일 record PATCH
- `copy <folder> --target <base-URL>` — base 통째 (다중 테이블)
- `copy <folder> --ref <URL> --target <URL>` — reference 기반 생성
- `copy` 단독 — 최근 폴더 메뉴 → md 모드
- 매 실행 = `output_v<NN>.md` + `output_v<NN>.prompt.md` 짝 저장

## 불가 ❌

| 작업 | 우회 |
|---|---|
| Framer 측 슬롯 자동 생성 | Framer 편집기에서 직접 만들고 sync 트리거 |
| 자동 push (Airtable 외) | md 결과 = `.md` 파일. CMS 등 push 는 별도 도구 |
| 멀티 모델 비교 한 번에 | 두 번 실행해 `v01`/`v02` 비교 |
| 어체 락 자동 주입 | 사용자가 `input/` 안 `.md` 에 직접 박음 |
| Layer 1·2·3 슬롯 분류 코드 | 도구는 모름. `input/` 폴더 구조·파일명으로 표현 |

---

## 새 프로젝트 시작 절차

```bash
mkdir -p <프로젝트>/input/{1,2,3,4,5}
cd <프로젝트>

# 숫자 폴더 안에 .md 1개씩 (사용자 컨벤션). 파일명은 사용자 보관·분류용:
#   input/
#   ├── 1/system.md       ← "너는 호텔 카피라이터다. 다음 원칙을 따른다..."
#   ├── 2/core.md         ← Layer 1 원칙
#   ├── 3/brand.md        ← Layer 2 모범답안 / 어체
#   ├── 4/facts.md        ← 시험지 (사실·IA)
#   └── 5/format.md       ← 답안 형식 명시
#
# 파일명은 자유 (`brand-v2.md` `brand-2026.md` 도 OK) — LLM 한테 안 보임.
# 한 숫자 폴더에 .md 여러 개 둬도 동작 (알파벳순 concat).

copy <프로젝트> -i "룸 섹션만 작성"
# → output/output_v01.md       (카피 본문)
# → output/output_v01.prompt.md (실제 들어간 user prompt 전문)
```

---

## airtable 모드 예시

```bash
# 단일 record 다듬기
copy <folder> --target "https://airtable.com/appXXX/tblYYY/recZZZ?..."
# → record ZZZ 의 필드를 schema 에 맞춰 PATCH

# base 통째 — 빈 base 채우기 또는 다중 테이블 일괄 업데이트
copy <folder> --target "https://airtable.com/appXXX/"
# → 응답 JSON = { "테이블1": [...records...], "테이블2": [...] }
# → id 있으면 PATCH, 없으면 POST

# reference 기반 생성
copy <folder> --ref "https://airtable.com/appREFERENCE/" --target "https://airtable.com/appTARGET/" -i "이 ref base 구조 그대로, 우리 호텔 사실로 채워"
# → ref schema+records 가 학습 자료로 들어감 (few-shot)
```

---

## 알려진 함정

1. **응답 안 펜스 (` ``` `) 가능성**. 도구가 자동으로 strip 하지만, 응답이 펜스 + 다른 텍스트 섞이면 JSON 파싱 실패 → 그래도 prompt.md 는 저장됨 (재시도 가능).
2. **layer 순서는 폴더 번호로**. 도구는 `input/<숫자>/` 폴더만 자연수순 봄. 파일명 prefix 가 아니라 **폴더 번호** (1, 2, 3, ...) 가 순서 결정. `input/` 직속 `.md` 나 비-숫자 폴더 (`templates/`, `00-system.md`) 는 무시됨.
3. **target schema 와 응답 테이블명 mismatch**. base 모드에서 응답 JSON 의 키가 schema 의 테이블 name 과 정확히 일치 안 하면 → "테이블 'X' 없음 — skip" 경고 후 그 테이블만 건너뜀.
4. **`copy-layers/` 글로벌 fallback 폐기 (2026-05-26~)**. 옛 도구에서 쓰던 `~/dev/clavier/clavier-scripts/copy-layers/{1-core,2-brand,3-section}/` 자동 로드는 새 도구에 없음. 그 자산을 쓰려면 작업 폴더 `input/` 안에 (또는 심링크) 두면 됨.

---

## 자주 잘못 알기 쉬운 것

- ❌ "도구가 폴더 안 `Layer 1`, `Layer 2` 구분해 처리" → **거짓**. 도구는 `input/<숫자>/*.md` 를 자연수순 + 알파벳순으로 concat 만. 슬롯·라벨·분기 0.
- ❌ "input/ 직속 .md 도 처리됨" → **거짓** (2026-05-26~). 숫자 이름 폴더 안에 들어가야만 봄. 직속 `.md` 와 비-숫자 폴더는 무시.
- ❌ "파일명·폴더명이 프롬프트에 헤딩으로 들어감" → **거짓**. 순수 `\n\n` concat. 파일명은 사용자 보관·분류용이라 LLM 한테는 안 전달.
- ❌ "system prompt 슬롯에 별도 시스템 지시" → **거짓** (2026-05-26~). claude CLI `--system-prompt` 인자 미사용. 모든 텍스트 user 로. 시스템 역할은 사용자가 `input/` 안 `.md` 에 박음.
- ❌ "어체 락이 자동 주입됨" → **거짓** (2026-05-26~). 어체 통제는 사용자가 `input/` 안에 명시 (예: `00-tone.md` 에 "이 어체로 그대로 작성합니다").
- ❌ "`output.md` 덮어쓰기됨" → **거짓**. `output_v<NN>.md` 다음 빈 번호로 자동 증가.
- ❌ "카피 작업은 정해진 폴더에서만 가능" → **거짓**. 폴더 위치 무관, 절대경로만 넘기면 됨.

---

## 참조

- 실행 코드: `~/dev/clavier/clavier-scripts/tools/copy.mjs`
- 공통 lib: `~/dev/clavier/clavier-scripts/tools/lib/copy/`
  - `input-loader.mjs` — 폴더 재귀 walk + concat
  - `airtable.mjs` — URL parse · schema fetch · PATCH/POST batch
  - `runner.mjs` — claude spawn · 버전 자동 증가 · 펜스 strip
  - `menu.mjs` — readline 인터랙티브 (workerCtl 패턴)
- 카피 작성 원칙·8단계 워크플로우: `capabilities/airtable-content-workflow.md` (airtable 도메인)
- 캐시: `~/.cache/clavier/copy.json`
- 옛 도구 (copyMd/Draft/Gen) — 2026-05-26 폐기. PR copy-rewrite 참조.

---

## 작업 시작 전 자동 주입 키워드

`카피작업 | 카피 작성 | 카피 다듬 | 카피 리뷰 | copy work | copy.mjs | tools/copy | output_v | input/ 카피 | 모범답안 | 시험지 (카피)`
