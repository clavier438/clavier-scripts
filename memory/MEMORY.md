# Memory Index

> **메모리 원칙**: 지침과 철학만 기록. 과거 작업 내역, 프로젝트 상태, 자격증명 위치 등 사실적 기록은 넣지 말 것. 코드/파일로 확인 가능한 것, 언제든 바뀔 수 있는 것은 제외. 메모리는 "어떻게 일할 것인가"에 대한 것이지 "무엇을 했는가"가 아님.

- [피드백: 메모리 저장 방식](feedback_memory.md) — 중요한 것은 항상 즉시 메모리에 저장할 것
- [피드백: 단계적 수정 방식](feedback_incremental_fixes.md) — 문제 하나씩 fix→확인→커밋 순서로 진행, 한꺼번에 고치지 말 것
- [피드백: git 기능 적극 제안](feedback_git_workflow.md) — 브랜치/태그/stash 등을 사용자가 묻기 전에 먼저 제안할 것
- [피드백: 깃 커밋 범위](feedback_git.md) — git commit은 scripts 폴더 작업에 한정
- [피드백: Clean Architecture 원칙](feedback_clean_architecture.md) — SOLID 원칙 적용, 비슷한 기능은 같은 방식으로 구현, Claude가 스스로 점검해서 먼저 제안
- [피드백: 자동화 순서 원칙](feedback_automation_order.md) — 자동화는 마지막 단계, 패턴 검증 전 스크립트 금지, 두 사슬 결합 방식 먼저 검토
- [피드백: env.md에서 API 키/토큰 먼저 확인](feedback_env_check.md) — API 키 등 env 값이 필요하면 env.md 먼저 확인, 없을 때만 물어볼 것
- [피드백: 프로젝트 컨텍스트는 PROGRESS.md로 repo에 보관](feedback_progress_md.md) — 개발 중인 repo에 PROGRESS.md 두고 커밋, 세션 시작 시 먼저 읽기
- [피드백: 데이터 소스 직접 읽기](feedback_data_source.md) — CSV/JSON 파일이 있으면 하드코딩 말고 파일 파싱해서 사용할 것
- [사용자 프로필](user_profile.md) — 역할, 목표, 작업 스타일 (응대 방식 조정용)
