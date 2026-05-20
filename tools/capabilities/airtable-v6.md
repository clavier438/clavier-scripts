# Airtable Upsert V6 — Claude 작업 컨텍스트

> 이 파일은 `tools/airtableUpsertV6.mjs` 의 `CAPABILITY_DOC` const 에서 자동 생성됨.
> 직접 수정 X — 도구 코드 안 const 만 수정. pre-commit 이 자동 sync.
> UserPromptSubmit hook 으로 Airtable 작업 시 자동 주입.

---

## 한 줄

**기존 Airtable base 에 콘텐츠 push 가 필요하면 V6 (`airtableCtl` / `airtableUpsertV6.mjs`) 사용.** 모델 base 는 web UI 에서 복제 → V6 로 데이터만 채움. 동일 input → 동일 base 상태 보장 (idempotent).

---

## 사용 시기 (자동 인지 트리거)

다음 케이스에서 V6 워크플로우 따른다:

- 사용자가 "이 base 에 [콘텐츠] 박아줘" / "데이터 채워줘" / "콘텐츠 만들어서 Airtable 에 올려"
- 사용자가 정해진 스키마의 Airtable base 가리키며 새 record / 기존 record 수정 의도
- CSV/JSON 데이터를 Airtable base 에 import 요청

**❌ 사용하지 말 것** (V6 의 역할이 아님):
- 새 base 생성 (= Airtable web UI 또는 사용자 직접)
- 새 field 생성 (= web UI — `slugKey` 한 가지만 V6 가 자동)
- record *삭제* (= web UI)

---

## 도구

```bash
# 사용자가 직접 = 인터랙티브 (메뉴)
airtableCtl

# Claude / script / cron = CLI
AIRTABLE_PAT=... node ~/Library/.../scripts/tools/airtableUpsertV6.mjs <baseId> <data_dir> [--dry-run] [--extend]
```

## 모드 (workerCtl push/stream 같은 두 모드 패턴)

### strict (default) — 안전

- 기존 base 의 record 만 update/create (matchKey 기준)
- 새 field 생성 X (`slugKey` 자동 추가만 예외)
- idempotency + destructive 안 함 보장

### extend (`--extend` opt-in) — 새 field 자동 추가 허용

- 위 + CSV 헤더에 base 에 없는 컬럼 있으면 → **`singleLineText` field 자동 생성**
- log 에 `<table>.<field>: CREATED` 명확히 표시
- 사용자가 명시적으로 켤 때만 동작

### V6 가 다루지 않는 schema 변경 (web UI 또는 별도 작업)

- link field (multipleRecordLinks) 추가
- formula / lookup / rollup 식 디자인
- primary field 변경
- field type 변경 (text → number 등)
- field / record 삭제

---

## data_dir 프로토콜 (엄격)

### 구조

```
<data_dir>/
  upsert.config.json   (선택, default 안전)
  topics.csv            ← 파일명 stem = base 의 테이블명 (정확히 일치)
  tags.csv
  items.csv
  ...
```

### CSV 헤더

- 1행 = **base 의 필드명 그대로**. 다른 이름 X
- base 의 모든 컬럼 다 박을 필요 X — 채울 컬럼만
- **`slugKey` 컬럼 필수** (영문 stable key)

### 컬럼별 셀 값 규칙

| base 필드 타입 | CSV 셀 값 |
|---|---|
| 텍스트/숫자/날짜/URL/이메일 | 값 그대로 |
| singleSelect | 옵션 이름 그대로 |
| multipleSelects | `\|` 구분 |
| checkbox | `"true"` / `"false"` |
| **multipleRecordLinks (link)** | **target 테이블의 `slugKey` 들, `\|` 구분** |
| multipleAttachments | URL 들, `\|` 구분 |
| formula / lookup / autoNumber / rollup | **박지 마** (있어도 자동 skip) |
| 빈 셀 | 변경 안 함 |

### link 예시 (가장 중요)

```csv
slugKey,name,topic,tags
room_sea_low,바다 숨소리가 가까운 방,rooms,season-spring|theme-sea
                                  ↑               ↑
                            target=topics    target=tags, 다중 = "|"
```

---

## Claude 가 콘텐츠 생성할 때 (★)

사용자가 콘텐츠 만들어달라 요청 시 — *직접 V6 형식 CSV 로 출력*:

1. **자료조사 + 컨셉** (대화로 협의)
2. **콘텐츠 생성** — 처음부터 V6 형식 CSV:
   - 각 record 의 `slugKey` 영문 stable key 부여
   - link 컬럼 = target table 의 slugKey 들, `|` 구분
   - formula/lookup/autoNumber/rollup 컬럼은 빼고
3. **data_dir 에 저장** — `<table>.csv` 파일별
4. **V6 push** — `--dry-run` 으로 확인 → 실제 실행
5. **결과 보고**

**❌ 사나(외부 LLM) 거치지 마**. 사나 무한 토큰 워크플로우는 폐기 (잘림 + 4-step 마찰).

---

## idempotency 원리

- `slugKey` = 매칭 키. 같은 slugKey 면 update, 없으면 create. 변하지 X
- Airtable native `performUpsert (fieldsToMergeOn: ["slugKey"])` — Airtable 자체가 매칭/upsert
- link = 2-pass (Pass 1 fields → 매핑 → Pass 2 link)
- **destructive 안 함**: CSV 에 없는 base record 손 안 댐

---

## 잘 잊는 것 5종

1. CSV 헤더는 base 필드명 그대로. `_record_id`, `id` 같은 다른 이름 박으면 매칭 X
2. `slugKey` 는 formula 가 아니라 일반 text — 사용자/Claude 가 명시적으로 박아야 함
3. link 셀에 rec ID (`rec...`) 박지 마. slugKey 박아라
4. formula 필드 (예: `slug = LOWER({name})`) 매칭 키로 쓰지 마 — drift 발생. 별도 slugKey text field
5. base 가 바뀌면 base ID 만 바꾸기 — 도구/data_dir/워크플로우 그대로

---

## 한 번 셋업 (새 base)

1. Airtable web UI → 모델 base 복제 (`Duplicate base`, "Include records" off)
2. 새 base ID 받음
3. V6 첫 실행 — `slugKey` field 자동 생성
4. 이후 콘텐츠 push 는 base ID 만 바꿔서 같은 도구

---

## 도구 위치

- 인터랙티브: `~/bin/airtableCtl` → `tools/airtableCtl.mjs`
- CLI: `tools/airtableUpsertV6.mjs`
- lib: `tools/lib/airtable-api.mjs`, `tools/lib/airtable-upsert.mjs`
- 자세한 옵션: `airtableCtl --help`

V5 (`airtableGenericV5_deleteMe.py`) 는 폐기 — computed field create 한계로 우회 결정.
