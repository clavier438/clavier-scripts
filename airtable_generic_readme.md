# Airtable 범용 업로더 v3

## 이게 뭐야

schema.json + CSV 파일들만 있으면 에어테이블에 테이블 생성, 데이터 업로드, 필드타입 설정, 테이블 간 Linked Record 연결까지 전부 자동으로 해주는 스크립트.

---

## 파일 구조

```
scripts/
└── airtableGeneric.py    ← 범용 스크립트 (여기 상주)
└── env.md                ← Airtable PAT (Mac 로컬용)

Google Drive/
└── airtable-jobs/
    ├── PROTOCOL.json     ← 타입 코드 정의 (불변, Sana/OCI 공통 참조)
    └── {job-name}/       ← 프로젝트마다
        ├── schema.json   ← Sana가 생성
        ├── foo.csv
        └── bar.csv
```

---

## 실행 방법

```bash
cd ~/path/to/job-folder      # schema.json + CSV 있는 폴더
python "${HOME}/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/airtableGeneric.py"
```

PAT 인식 순서: `AIRTABLE_PAT` 환경변수 → 스크립트 옆 `env.md`

---

## 워크플로우

```
1. Sana와 콘텐츠 기획
2. Sana가 CSV + schema.json 생성 (PROTOCOL.json 참조)
3. Sana가 Google Drive airtable-jobs/{job-name}/ 에 업로드
4. 터미널 or OCI 트리거로 실행
5. Airtable 확인
```

---

## schema.json 포맷 (v1)

```json
{
  "version": "1",
  "job": "폴더명과_동일",
  "base": "design",
  "tables": [
    {
      "name": "브랜드사례",
      "csv": "brand_cases.csv",
      "primary_key": "모델명",
      "fields": {
        "카테고리":   "SEL",
        "규모":       "SEL",
        "핵심교훈":   "LNG",
        "사용브랜드": { "type": "LNK", "target": "브랜드_플레이북" }
      }
    }
  ]
}
```

### 타입 코드 (PROTOCOL.json 기준)

| 코드 | Airtable 타입 | 비고 |
|------|---------------|------|
| `TXT` | singleLineText | 기본값 — 생략 가능 |
| `SEL` | singleSelect | CSV 고유값으로 선택지 자동 생성 |
| `LNG` | multilineText | |
| `LNK` | multipleRecordLinks | `{ "type": "LNK", "target": "테이블명" }` |

---

## 스크립트가 하는 일 (3단계)

**Phase 1 — 테이블 생성 + 업로드**
schema.json의 각 테이블 정의를 읽고 에어테이블에 테이블 생성. CSV 데이터를 10건씩 batch로 업로드.

**Phase 2 — Linked Record 필드 생성**
LNK 컬럼에 multipleRecordLinks 타입 필드 생성. 에어테이블 자동 생성 역방향 필드를 config에서 찾아 rename.

**Phase 3 — 링크 데이터 연결**
CSV의 콤마 구분 텍스트를 실제 record ID로 변환해서 연결. 정확 매칭 → 괄호 제거 매칭 → 부분 매칭 순서로 시도.

---

## 에러 대응

| 에러 | 원인 | 자동 대응 |
|------|------|-----------|
| 429 Rate Limited | API 호출 과다 | Retry-After 헤더만큼 대기 후 재시도 |
| 422 + options | API 스키마 변경 | linkedTableId만 남기고 재시도 |
| schema 유효성 오류 | LNK target 없음 등 | 실행 전 검사 후 메시지 출력 종료 |

---

## 전제조건

- `pip install requests` (최초 1회)
- Airtable PAT scope: `data.records:write` + `schema.bases:read` + `schema.bases:write`
- PAT access: 대상 base 선택되어 있어야 함

---

---

# forSana — schema.json 생성 규격

사용자가 "에어테이블에 넣어줘" 또는 "schema 만들어줘"라고 요청하면 이 규격에 따라 schema.json을 생성합니다.

## 생성할 파일

```
{job-name}/
├── schema.json
├── table_a.csv
└── table_b.csv
```

`job-name`은 `{주제}_{YYYY_MM}` 형식 권장. 예: `brand_research_2026_04`

## schema.json 스키마

```json
{
  "version": "1",
  "job": "{job-name}",
  "base": "design",
  "tables": [
    {
      "name": "에어테이블_테이블명",
      "csv": "실제_파일명.csv",
      "primary_key": "기본키_컬럼명",
      "fields": {
        "{컬럼명}": "TXT | SEL | LNG | { \"type\": \"LNK\", \"target\": \"테이블명\" }"
      }
    }
  ]
}
```

## 타입 코드 판단 기준

| 조건 | 코드 |
|------|------|
| 고유값 15개 이하, 짧고 반복 (카테고리, 상태, 등급 등) | `SEL` |
| 값이 길고 서술적 (설명, 교훈, 분석 등) | `LNG` |
| 다른 테이블 값이 콤마로 나열된 컬럼 | `LNK` |
| 그 외 모두 | 생략 (TXT 기본값) |

## 주의사항

1. `job` 값은 폴더명과 정확히 일치해야 함
2. `csv` 값은 다운로드될 실제 파일명과 일치해야 함
3. `LNK target`으로 참조한 테이블은 반드시 같은 `tables` 배열에 존재해야 함
4. `primary_key`는 해당 CSV에 실제로 존재하는 컬럼명이어야 함
5. CSV 인코딩: UTF-8 with BOM (`encoding="utf-8-sig"`)
6. Linked Record 컬럼의 CSV 값: 콤마 구분, target 테이블 primary_key와 일치하는 값
