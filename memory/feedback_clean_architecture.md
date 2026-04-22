---
name: 피드백: Clean Architecture 원칙 적용
description: Robert C. Martin의 Clean Architecture(SOLID) 원칙을 모든 코드 작성 시 적용할 것
type: feedback
originSessionId: c4863b1c-6a96-49cd-bb46-3035f778bbc1
---
모든 코드 작성 시 Clean Architecture (Robert C. Martin / Uncle Bob) 원칙을 기준으로 판단한다.

**핵심**: 의존성은 항상 안쪽(비즈니스 로직)을 향해야 한다. 외부(API, DB, UI)가 안쪽에 영향을 주면 안 된다.

- **SRP**: 함수/모듈 하나 = 변경 이유 하나. 두 가지 이상 하면 분리.
- **OCP**: 확장엔 열림, 수정엔 닫힘. 새 기능 = 기존 코드 수정 최소화.
- **DIP**: 구체가 아닌 추상에 의존. 토큰/경로는 상수, 로직은 함수로 분리.

**Why:** 사용자가 일관되고 유지보수 가능한 코드를 원함. 시스템이 계속 확장되므로 설계 원칙이 중요.
**How to apply:** 코드 작성 전 "이 함수가 한 가지만 하는가?", "외부 의존이 로직 안에 박혀있진 않은가?" 확인.
비슷한 기능은 같은 방식으로 구현 — 기존 패턴 확장 우선, 신규 패턴 생성 금지.
