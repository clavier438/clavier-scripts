# Airtable Upsert V6 — Claude 작업 컨텍스트

> 이 파일은 UserPromptSubmit hook 으로 자동 주입됨 (`tools/contextInject.json` domain=airtable).
> Airtable 콘텐츠 작업 시 자동으로 Claude 컨텍스트에 들어옴.
> 마지막 갱신: 2026-05-20

---

## 한 줄

**기존 Airtable base 에 콘텐츠 push 가 필요하면 V6 (`airtableCtl` / `airtableUpsertV6.mjs`) 사용.** 모델 base 는 web UI 에서 복제 → V6 로 데이터만 채움. 동일 input → 동일 base 상태 보장 (idempotent).

---

## 사용 시기 (자동 인지 트리거)

다음 케이스에서 V6 워크플로우 따른다:

- 사용자가 "이 base 에 [콘텐츠] 박아줘" / "데이터 채워줘" / "콘텐츠 만들어서 Airtable 에 올려" 같은 요청
- 사용자가 정해진 스키마를 가진 Airtable base 를 가리키며 새 record / 기존 record 수정 의도
- CSV/JSON 데이터를 Airtable base 에 import 요청

**❌ 사용하지 말 것** (V6 의 역할이 아님):
- 새 base 생성 (= 수동 — Airtable web UI 또는 사용자 직접)
- 새 field 생성 (= 수동, web UI — `slugKey` field 한 가지만 V6 가 자동)
- record *삭제* (= 수동, web UI)

---

## 도구 (둘 중 골라서)

```bash
# 사용자가 직접 = 인터랙티브 (메뉴)
airtableCtl

# Claude / script / cron = CLI
AIRTABLE_PAT=... node ~/Library/.../scripts/tools/airtableUpsertV6.mjs <baseId> <data_dir> [--dry-run]
```

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
- **`slugKey` 컬럼 필수** (영문 stable key — 매번 같은 값이어야 함)

### 컬럼별 셀 값 규칙

| base 필드 타입 | CSV 셀 값 |
|---|---|
| 텍스트/숫자/날짜/URL/이메일 | 값 그대로 |
| singleSelect | 옵션 이름 그대로 |
| multipleSelects | `\|` 구분 |
| checkbox | `"true"` / `"false"` |
| **multipleRecordLinks (link)** | **target 테이블의 `slugKey` 값들, `\|` 구분** |
| multipleAttachments | URL 들, `\|` 구분 |
| formula / lookup / autoNumber / rollup | **박지 마** (있어도 자동 skip) |
| 빈 셀 | 변경 안 함 (기존 값 유지) |

### link 예시 (가장 중요)

```csv
slugKey,name,topic,tags
room_sea_low,바다 숨소리가 가까운 방,rooms,season-spring|theme-sea
                                  ↑               ↑
                            target=topics    target=tags, 다중 = "|"
```

→ `topic` 컬럼은 topics 테이블 record 중 `slugKey="rooms"` 인 record 와 자동 link.
→ `tags` 컬럼은 tags 테이블 record 중 `slugKey="season-spring"`, `slugKey="theme-sea"` 두 개와 link.

---

## Claude 가 콘텐츠 생성할 때 (★)

사용자가 콘텐츠 만들어달라 요청 시 — *직접 V6 형식 CSV 로 출력*:

1. **자료조사 + 컨셉** (대화로 사용자와 협의)
2. **콘텐츠 생성** — 처음부터 V6 형식 CSV 로:
   - 각 record 의 `slugKey` 영문 stable key 부여 (예: `room_sea_low`, `food_menu_spring`, `tag_seasonal`)
   - link 컬럼 = target table 의 slugKey 들, `|` 구분
   - formula/lookup/autoNumber/rollup 컬럼은 빼고
3. **data_dir 에 저장** — `<table>.csv` 파일별
4. **V6 push** — `airtableUpsertV6.mjs <baseId> <data_dir> --dry-run` → 확인 → 실제 실행
5. **결과 보고** — 어떤 record 가 create / update 됐는지

**❌ 사나(외부 LLM) 거치지 마**. 사용자가 사나 무한 토큰 매달리는 워크플로우는 폐기 (잘림 + 4-step 마찰). V6 도구로 직접 push.

---

## idempotency 보장 — 어떻게 (핵심 원리)

- `slugKey` = 매칭 키. 같은 slugKey 면 update, 없으면 create. **변하지 X**.
- Airtable native `performUpsert (fieldsToMergeOn: ["slugKey"])` 호출 — Airtable 자체가 매칭/upsert 처리. Claude / 사용자 매핑 로직 X
- link = 2-pass (Pass 1 fields → 매핑 빌드 → Pass 2 link resolve)
- **destructive 안 함**: CSV 에 없는 base record 손 안 댐 (사용자 의도와 무관한 record 보존)

→ 같은 CSV 두 번 push → record 수 안 늘어남 (검증됨).

---

## 잘 잊는 것들

- **컬럼명은 base 그대로**. CSV 헤더 다르게 박으면 (`_record_id`, `id` 등) → 그 컬럼은 base 매칭 안 됨 → 무시됨
- **slugKey 는 base 가 자동 계산하지 X** — formula 가 아니라 일반 text. 사용자/Claude 가 명시적으로 박아야 함
- **link 셀에 rec ID 박지 마** (예: `recb37c888c0281d2`). slugKey 박아라
- **formula 필드 (예: `slug = LOWER({name})`) 매칭 키로 쓰지 마** — formula 는 자동 변하니 idempotency 깨짐. 별도 `slugKey` text field 사용
- **base 가 바뀌면 base ID 만 바꾸기** — 도구 코드 / data_dir / Claude 워크플로우 다 그대로

---

## 한 번 셋업 (새 base 시작 시)

1. Airtable web UI 에서 모델 base 복제 (`Duplicate base`, "Include records" 옵션 off)
2. 새 base ID 받음 (예: `appgxPRRxUpgtnoZ9`)
3. V6 첫 실행 — `slugKey` field 자동 생성됨 (한 번)
4. 이후 모든 콘텐츠 push 는 같은 도구 + base ID 만 바꿔서

---

## 도구 위치

- 인터랙티브: `~/bin/airtableCtl` → `tools/airtableCtl.mjs`
- CLI: `tools/airtableUpsertV6.mjs`
- lib: `tools/lib/airtable-api.mjs`, `tools/lib/airtable-upsert.mjs`
- 자세한 옵션: `airtableCtl --help`

V5 (`airtableGenericV5_deleteMe.py`) 는 폐기 — 새 base 생성용이었으나 computed field (rollup/lookup/autoNumber) create 한계로 우회 결정.
