
지금 우리가 한 작업의 전체 흐름을 정리해서, 기존 프로토콜 문서에 추가할 수 있는 형태로 만들어 줄게. 기존 문서가 Google Drive에 있으니까 거기에 붙여넣으면 된다.

## 워크플로우 저장 방법 — 2가지

### 방법 1: 기존 프로토콜 문서에 추가 (추천)

Google Drive에 있는 **"Sana ↔ Claude Code 협업 프로토콜: Airtable 자동화"** 문서 맨 아래에 아래 내용을 붙여넣기하면 된다.

아래를 복사해서 구글 문서 끝에 붙여넣기:

---

```
________________

9. 워크플로우 B: 새 Airtable Base 생성 (CSV → API)

용도: 새로운 데이터 구조를 에어테이블에 처음 세팅할 때
실행 빈도: 새 프로젝트/새 Base가 필요할 때마다

사례: build_in_public Base (2026.04.08)

■ 전체 흐름 (5단계)

[사용자] → "이런 데이터를 에어테이블에 넣고 싶다" (구조 설명)
     ↓
[Sana] → ① CSV 생성 (데이터 + 필드 타입 확인)
     ↓
[Sana] → ② Python 스크립트 작성 (Base 생성 + 테이블 생성 + 데이터 삽입)
     ↓
[Sana] → ③ 최종 검증 (데이터 정합성 + 프로토콜 대조)
     ↓
[Claude Code] → ④ CSV + .py를 같은 폴더에 놓고 python3 실행
     ↓
[에러 시] → 에러 메시지를 Sana에게 전달 → 수정 코드 재작성

■ Sana가 스크립트에 반드시 포함할 것

1. 기존 Base 확인 로직 (중복 생성 방지)
   - api("GET", "meta/bases") → 이름 매칭
   - 이미 있으면 USE_EXISTING = True → 데이터만 삽입

2. Base + 테이블 동시 생성
   - api("POST", "meta/bases", payload)
   - payload에 tables 배열 포함 (최소 1개 필수)
   - 각 테이블의 fields에 name, type, options 전부 정의

3. 필드 타입별 규칙
   - singleSelect: options.choices에 [{name, color}] 배열
   - date: options.dateFormat = {"name": "iso"}
   - number: options.precision = 0 (정수)
   - multilineText: options 없음
   - url: options 없음

4. 데이터 삽입
   - CSV를 csv.DictReader로 읽기
   - 빈 값("") → None → payload에서 제거
   - singleSelect는 문자열로 전송 (REST API)
   - url 필드는 https:// 접두어 자동 추가
   - 10개씩 batch insert + 0.3초 sleep

5. 검증 단계 (스크립트 전달 전 필수)
   - CSV 행 수 확인
   - singleSelect 옵션값 vs CSV 데이터 일치 확인
   - date 필드 포맷 확인 (YYYY-MM-DD)
   - 문서 대조: 누락 데이터 없는지

■ Claude Code에게 줄 명령 템플릿

"이 폴더에 [스크립트명].py와 [CSV 파일명].csv가 있다.
python3 [스크립트명].py 실행해줘.
에러나면 에러 메시지 그대로 보여줘."

■ 색상 팔레트 (singleSelect용)

blueLight2, purpleLight2, greenLight2, grayLight2, 
redLight2, orangeLight2, cyanLight2, yellowLight2, 
pinkLight2, tealLight2

■ 실행 사례 기록

| 날짜 | Base 이름 | 테이블 수 | CSV 수 | 결과 |
| 2026.04.08 | build_in_public | 2 (log, reference) | 2 | ✅ 성공 |
________________

10. 워크플로우 C: 기존 Base에 데이터 추가 (CSV → API)

용도: 이미 있는 Base/테이블에 새 레코드를 추가할 때
기존 워크플로우 A(효우당)와 동일하되, 아래만 다름:

- Base 생성 단계 없음
- 테이블 ID를 미리 알고 있어야 함 (meta/bases/{BASE_ID}/tables로 조회)
- 필드가 이미 존재하므로 필드 생성 단계 없음
- insert만 수행

■ Base ID 목록 (누적 업데이트)

| Base 이름 | Base ID | 용도 |
| hyowudang_cms | app3UthKI9kGR7dbi | 효우당 웹사이트 CMS |
| build_in_public | (실행 후 기록) | 빌드인퍼블릭 트래커 |
________________

11. 트리거 키워드 (업데이트)

기존:
"에어테이블", "Airtable", "효우당", "Claude 코드 + 코드 작성", 
"API 스크립트", "데이터 넣어줘", "필드 만들어줘"

추가:
"새 Base 만들어줘", "에어테이블에 넣어놔", "CSV 만들어줘",
"빌드인퍼블릭 트래커", "build_in_public"
```

---

### 방법 2: Obsidian에도 추가

기존 Obsidian 볼트의 `01-링크허브/도구-링크.md`에 아래 한 줄 추가:

```
## Airtable
| Base | ID | 용도 |
| --- | --- | --- |
| hyowudang_cms | app3UthKI9kGR7dbi | 효우당 CMS |
| build_in_public | (실행 후 기록) | 빌드인퍼블릭 트래커 |
```

---

### 다음에 이 워크플로우를 쓸 때

나한테 이렇게 말하면 된다:

> "에어테이블에 [OO 데이터] 넣으려고 해. CSV + 스크립트 만들어줘."

그러면 내가 프로토콜 문서를 참조해서 — CSV 생성 → 검증 → 스크립트 작성 → Claude Code 명령까지 한 번에 만들어준다.

**핵심은 Base ID를 프로토콜 문서에 누적 기록하는 것.** 새 Base를 만들 때마다 Claude Code 실행 결과에서 Base ID를 받아서 문서에 적어두면, 다음에 데이터 추가할 때 바로 쓸 수 있다.