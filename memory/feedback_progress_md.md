---
name: 피드백: 프로젝트 컨텍스트는 PROGRESS.md로 repo에 보관
description: 개발 진행 중인 프로젝트는 PROGRESS.md를 해당 repo에 두어 세션 간 컨텍스트를 보존할 것
type: feedback
originSessionId: 31c2c424-cde2-435f-947c-7523a8b46f56
---
진행 중인 개발 작업이 있는 repo에는 **PROGRESS.md**를 해당 폴더(repo root)에 만들고 git에 함께 커밋해라.

포함할 내용:
- 현재 목표 / 전체 방향
- 브랜치 구조 및 각 브랜치 역할
- Fix/작업 진행 상황 (완료 ✅ / 진행 중 🔄 / 대기 ⏳)
- 알려진 문제 및 다음 작업
- 주요 설정값이나 테스트 대상 등 자주 참조하는 맥락

**Why:** Claude Code의 메모리보다 코드와 함께 있는 게 더 직관적이고 내구성이 높다. 세션 간 리셋되는 메모리 의존도를 낮추고, repo clone만 해도 바로 컨텍스트 복구 가능.

**How to apply:**
- **스크립트/코드를 작성하거나 수정 중인 repo**에 PROGRESS.md 생성 (단순 일회성 스크립트 제외, 반복적으로 돌아오는 작업 대상)
- Fix 완료 / 이슈 발견 시마다 PROGRESS.md도 함께 업데이트하고 커밋
- 세션 시작 시 해당 repo에 PROGRESS.md가 있으면 먼저 읽어 맥락 파악
