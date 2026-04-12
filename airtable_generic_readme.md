# Airtable 범용 업로더

## 이게 뭐야

CSV 파일 + config.json만 있으면 에어테이블에 테이블 생성, 데이터 업로드, 필드타입 설정, 테이블 간 Linked Record 연결까지 전부 자동으로 해주는 스크립트.

## 파일 구조

```
~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/
├── airtableGeneric.py    ← 범용 스크립트 (여기 상주, 한번만 넣으면 됨)
└── env.md                ← Airtable PAT 토큰 (이미 있음)
```

프로젝트할 때마다 아무 폴더에:

```
~/Desktop/my_project/
├── config.json           ← 사나가 만들어줌
├── data_a.csv            ← 사나가 만들어줌
└── data_b.csv            ← 사나가 만들어줌
```

## 실행 방법

```bash
cd ~/Desktop/my_project
python "${HOME}/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/airtableGeneric.py"
```

끝. 클로드 필요 없음. 터미널에서 직접 실행.

## 워크플로우 (매번 반복)

```
1. 사나 대화에서 CSV를 만든다
2. 사나에게 "에어테이블 config 만들어줘" 한다
3. CSV들 + config.json을 한 폴더에 다운로드
4. 터미널에서 위 명령어 실행
5. 에어테이블 확인
```

## config.json 설명

```json
{
  "base": "design",           // 어느 베이스에 넣을지
  "tables": [
    {
      "name": "테이블_이름",    // 에어테이블에 생성될 테이블명
      "csv": "data_a.csv",     // 이 테이블의 데이터 파일
      "primary": "모델명",      // 기본 키 (다른 테이블에서 이 값으로 매칭)

      "singleSelect": [        // SingleSelect 필드 목록
        "카테고리",              //   → CSV의 고유값을 자동 추출해서 선택지 생성
        "초기자본규모"
      ],

      "multilineText": [       // 긴 텍스트 필드 목록
        "핵심교훈"
      ],

      "links": {               // 다른 테이블과의 연결
        "사용브랜드": {          //   이 컬럼이 Linked Record가 됨
          "target_table": "브랜드_플레이북"   // 연결 대상 테이블 (반드시 tables에 정의)
        }
      }
    }
  ]
}
```

**config에 안 적은 컬럼**은 전부 일반 텍스트(singleLineText)로 들어감.\
**links에 적은 컬럼**의 CSV 값은 콤마 구분 텍스트 → 자동으로 record ID 매칭.
**중요:** `links.*.target_table`로 참조한 테이블은 반드시 같은 `tables` 배열에 `name`으로 정의되어 있어야 함.
`target_primary`는 넣어도 되지만 현재 스크립트에서는 사용하지 않음(호환용 필드).

## 스크립트가 하는 일 (3단계)

**Phase 1 — 테이블 생성 + 업로드**\
config의 각 테이블 정의를 읽고 에어테이블에 테이블 생성. CSV 데이터를 10건씩 batch로 업로드. links 컬럼은 이 단계에서 건너뜀.

**Phase 2 — Linked Record 필드 생성**\
links 정의를 읽고 multipleRecordLinks 타입 필드 생성. 에어테이블이 자동 생성하는 역방향 필드를 config에서 찾아 rename.

**Phase 3 — 링크 데이터 연결**\
CSV의 콤마 구분 텍스트를 실제 record ID로 변환해서 연결. 정확 매칭 → 괄호 제거 매칭 → 부분 매칭 순서로 시도.

## 사나에게 config 요청하는 법

CSV를 만든 뒤 이렇게 말하면 됨:

> "이 CSV들을 에어테이블 \[베이스명\]에 넣을 config.json 만들어줘.\
> \[컬럼A, 컬럼B\]는 SingleSelect로,\
> \[컬럼C\]는 긴 텍스트로,\
> \[테이블1.컬럼X\]와 \[테이블2.컬럼Y\]는 Linked Record로 연결해줘."

구체적으로 안 말해도 사나가 CSV 구조를 분석해서 적절한 필드타입을 자동 판단함.

## 에러 대응

| 에러 | 원인 | 자동 대응 |
| --- | --- | --- |
| 429 Rate Limited | API 호출 과다 | Retry-After 헤더만큼 대기 후 재시도 |
| 422 + options | API 스키마 변경 | linkedTableId만 남기고 재시도 |
| 파일 없음 | CSV/config 경로 불일치 | 에러 메시지 출력 후 종료 |

422 재시도도 실패하면 터미널 에러 메시지를 보고 수동 대응 필요.

## 전제조건

- `pip install requests` (최초 1회)
- env.md에 Airtable PAT이 `pat`으로 시작하는 형태로 존재
- PAT scope: `data.records:write` + `schema.bases:read` + `schema.bases:write`
- PAT access: 대상 base 선택되어 있어야 함





# forSana_Airtable 업로더 — Sana 참조 규격

이 문서는 사나(AI)가 Airtable 업로드용 config.json을 생성할 때 참조하는 규격서입니다.\
사용자가 "에어테이블에 넣어줘" 또는 "config 만들어줘"라고 요청하면 이 규격에 따라 config.json을 생성합니다.

---

## 시스템 구조

```
[고정] ~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/
├── airtableGeneric.py    ← 범용 스크립트 (절대 수정 안함)
├── env.md                ← Airtable PAT 토큰
└── 이 문서                ← Sana 참조 규격

[매번 생성] 사용자가 지정한 프로젝트 폴더/
├── config.json           ← Sana가 생성
├── *.csv                 ← Sana가 생성
```

사용자는 프로젝트 폴더에서 아래 명령어를 실행합니다:

```bash
python "${HOME}/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/airtableGeneric.py"
```

---

## config.json 스키마

```json
{
  "base": "베이스명",
  "tables": [
    {
      "name": "에어테이블_테이블명",
      "csv": "실제_파일명.csv",
      "primary": "기본키_컬럼명",
      "singleSelect": ["컬럼A", "컬럼B"],
      "multilineText": ["컬럼C"],
      "links": {
        "링크컬럼명": {
          "target_table": "연결할_테이블명"
        }
      }
    }
  ]
}
```

### 필수 필드

| 필드 | 설명 |
| --- | --- |
| `base` | Airtable 베이스 이름. 사용자가 지정 안하면 `"design"` 사용 |
| `tables[].name` | 에어테이블에 생성될 테이블 이름 |
| `tables[].csv` | CSV 파일명. **다운로드되는 실제 파일명과 정확히 일치해야 함** |
| `tables[].primary` | 기본 키. Linked Record 매칭에 사용되는 컬럼 (보통 첫번째 컬럼) |

### 선택 필드

| 필드 | 설명 | 기본값 |
| --- | --- | --- |
| `singleSelect` | SingleSelect로 만들 컬럼 목록 | `[]` (없으면 전부 텍스트) |
| `multilineText` | 긴 텍스트로 만들 컬럼 목록 | `[]` |
| `links` | Linked Record 정의 (`target_table`은 반드시 `tables[].name`에 존재해야 함) | `{}` (없으면 링크 없음) |

`links` 내부의 `target_primary`는 과거 호환용 필드이며, 현재 스크립트는 이 값을 사용하지 않습니다.

---

## 필드타입 판단 기준

Sana가 CSV를 분석할 때 아래 기준으로 필드타입을 결정합니다:

### singleSelect로 만드는 경우

- 고유값이 **15개 이하**인 컬럼
- 값이 짧고(20자 미만) 반복되는 패턴
- 예: 카테고리, 등급, 상태, 규모, 유형 등 분류성 데이터

### multilineText로 만드는 경우

- 값이 길고(50자 이상) 서술적인 컬럼
- 예: 설명, 교훈, 증거, 분석 등 문장형 데이터

### singleLineText (기본값)

- 위 두 조건에 해당하지 않는 모든 컬럼
- 예: 이름, 사례, 공식, 메커니즘 등

### links로 만드는 경우

- CSV에 콤마 구분으로 다른 테이블의 값이 나열된 컬럼
- 예: "향수/캔들/디퓨저, 스킨케어/웰니스 제품" → 수익모델 테이블과 연결
- **links 컬럼의 CSV 값은 반드시 target_table의 primary 컬럼 값과 일치해야 함**
- **links.target_table로 참조한 테이블은 반드시 같은 config.json의 tables 배열에 포함되어야 함**

---

## CSV 작성 규칙 (Sana용)

### 파일명

- 한글 가능하지만, **공백 없이** 언더스코어 사용
- 예: `brand_cases.csv`, `revenue_models.csv`

### 링크 컬럼 값 형식

- 콤마로 구분: `"모델A, 모델B, 모델C"`
- 연결할 값이 없으면: `"없음"` 또는 빈칸
- 값은 **target_table의 primary 컬럼에 있는 값과 동일해야 함**
- 괄호 안 부가정보는 매칭 시 자동 제거됨: `"프라이빗 멤버십 클럽 (전환중)"` → `"프라이빗 멤버십 클럽"`으로 매칭 시도

### 인코딩

- UTF-8 with BOM (utf-8-sig) — pandas의 `to_csv(encoding="utf-8-sig")` 사용

---

## Sana 응답 플로우

사용자가 "에어테이블에 넣어줘"라고 하면:

### Step 1: CSV 확인

현재 대화에서 생성된 CSV가 있는지 확인. 없으면 먼저 CSV 생성.

### Step 2: 구조 분석

각 CSV의 컬럼을 분석하여:

- 어떤 컬럼이 singleSelect인지
- 어떤 컬럼이 multilineText인지
- 테이블 간 연결이 필요한 컬럼이 있는지

### Step 3: config.json 생성

위 스키마에 맞는 config.json 생성. run-python-tool로 JSON 파일 생성.

### Step 4: 사용자에게 전달

CSV 파일들 + config.json을 다운로드 가능하게 제공하며, 실행 명령어 안내:

```
cd [폴더경로]
python "${HOME}/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/airtableGeneric.py"
```

### Step 5: 베이스명 확인

사용자가 베이스를 지정하지 않았으면 확인. 기본값은 `"design"`.

---

## 주의사항

1. **CSV 파일명은 다운로드 시 변할 수 있음** — Sana 샌드박스에서 .csv 파일은 정상 다운로드되지만, 접미사(`_final` 등)가 붙을 수 있음. config.json의 csv 필드는 **실제 다운로드될 파일명**과 일치시켜야 함.

2. **한 번에 테이블 10개 이상은 피할 것** — Airtable API rate limit (5 req/sec) 때문에 테이블이 많으면 시간이 오래 걸림.

3. **기존 테이블과 이름 충돌 주의** — 같은 이름의 테이블이 이미 있으면 에러남. 사용자에게 기존 테이블 덮어쓸지 확인.

4. **SingleSelect 선택지는 CSV 고유값에서 자동 생성** — config에 선택지 목록을 넣을 필요 없음. 스크립트가 CSV를 읽어서 자동으로 만듦.

5. **Linked Record는 양방향** — A→B 링크를 만들면 B→A가 자동 생성됨. config에 양쪽 다 적되, 스크립트가 중복 생성은 자동 방지함.

6. **links 대상 테이블 누락 금지** — `stories`만 정의해놓고 `links.target_table`에서 `pages/items`를 참조하면 실패함. 링크 대상 테이블도 반드시 `tables`에 함께 정의해야 함.
