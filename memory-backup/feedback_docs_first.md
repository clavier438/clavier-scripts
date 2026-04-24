---
name: 공식 문서 우선 원칙 / 바퀴 재발명 금지
description: 새 API/서비스 연동 시 레퍼런스를 먼저 찾아 그대로 따른다 — 추측·재발명 금지
type: feedback
originSessionId: 62abaf37-2596-4bf1-89a6-d1bd46cf0b28
---
**핵심 원칙: 바퀴를 다시 발명하지 마라.**

반드시 누군가는 먼저 해봤다. 공식 문서, 공식 플러그인 소스, 비슷한 일을 하는 라이브러리 — 이것들은 수많은 시행착오를 반영한 나름 최선의 결과다.

**Why:** framer-api enum 처리 시 공식 소스 안 보고 추측으로 수십 번 시행착오. ManagedCollection이 서버 SDK에 있는지 확인 안 하고 "브라우저 전용"이라 단정해 몇 시간을 낭비. 레퍼런스 클래스를 처음부터 봤으면 바로 끝났을 일.

## ⚖️ 법칙 (권장사항이 아님 — 예외 없음)

**새 API/라이브러리 쓰기 전에 반드시 패키지 타입 정의(.d.ts)와 공식 소스를 직접 열어 확인한다.**
- "안 될 것 같다" 는 추측 금지. 반드시 grep/read로 존재 여부 확인 후 판단.
- 확인 전에 "불가능하다"고 말하는 것 자체가 위반.

**How to apply:**
1. 공식 문서/플러그인 소스코드 → 그대로 가져와 최소한만 적응
2. 공식 자료가 없어도 반드시 서칭해서 **레퍼런스 클래스**를 찾는다
3. 가장 진보한 케이스를 따른다. 막히면 즉시 소스코드 확인 — 추측 금지
4. 순서: **레퍼런스 그대로 → 동작 확인 → 단점 느껴지면 그때 수정**. 반대 순서 절대 금지
5. 그래도 불만이면: 여러 레퍼런스의 장단점 파악 후 조합해서 새로 구현
6. 구조적 차이에서 비롯한 것만 수정. 나머지는 공식 코드 그대로

**framer-api 공식 자료:**
- Airtable 플러그인: https://github.com/framer/plugins/tree/main/plugins/airtable
  - fields.ts: 필드 타입 추론
  - data.ts: getFieldDataEntryForFieldSchema (값 변환 핵심)
- 문서: https://www.framer.com/developers/server-api-reference
- 예제: https://github.com/framer/server-api-examples
