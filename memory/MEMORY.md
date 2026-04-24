# Memory Index

> **메모리 원칙**: Claude 행동지침만 기록. 시스템 구조/사실 정보는 각 repo의 ARCHITECTURE.md에. "어떻게 일할 것인가"만 여기에.

- [피드백: 문서 역할 분담 원칙](feedback_doc_structure.md) — ARCHITECTURE.md/git/memory 역할 분담 + 에코시스템 수준 메모리 예외 원칙
- [에코시스템 아키텍처 인사이트](project_ecosystem_architecture.md) — Worker=계산레이어, Framer/Airtable/CF/OCI/Google 조합 패턴 (제안용)
- [피드백: 메모리 저장 방식](feedback_memory.md) — 중요한 것은 항상 즉시 메모리에 저장할 것
- [피드백: 단계적 수정 방식](feedback_incremental_fixes.md) — 문제 하나씩 fix→확인→커밋 순서로 진행, 한꺼번에 고치지 말 것
- [피드백: git 기능 적극 제안](feedback_git_workflow.md) — 브랜치/태그/stash 등을 사용자가 묻기 전에 먼저 제안할 것
- [피드백: 깃 커밋 범위](feedback_git.md) — git commit은 scripts 폴더 작업에 한정
- [피드백: Clean Architecture 원칙](feedback_clean_architecture.md) — SOLID 원칙 적용, 비슷한 기능은 같은 방식으로 구현, Claude가 스스로 점검해서 먼저 제안
- [피드백: 자동화 순서 원칙](feedback_automation_order.md) — 자동화는 마지막 단계, 패턴 검증 전 스크립트 금지, 두 사슬 결합 방식 먼저 검토
- [피드백: env.md에서 API 키/토큰 먼저 확인](feedback_env_check.md) — API 키 등 env 값이 필요하면 env.md 먼저 확인, 없을 때만 물어볼 것
- [피드백: 데이터 소스 직접 읽기](feedback_data_source.md) — CSV/JSON 파일이 있으면 하드코딩 말고 파일 파싱해서 사용할 것
- [피드백: 공식 문서 우선 원칙](feedback_docs_first.md) — 새 API 연동 시 공식 docs/예제 먼저, 바퀴 재발명 금지
- [피드백: 레퍼런스 클래스 탐색 방법론](feedback_reference_class.md) — 구현 전 동작 중인 케이스 먼저 탐색, 소스코드 직접 획득 우선, 한계 평가 후 합의하고 시작
- [사용자 프로필](user_profile.md) — 역할, 목표, 작업 스타일 (응대 방식 조정용)
- [프로젝트: hotelAgency_ops](project_hotel_agency_ops.md) — Notion→Airtable 마이그레이션, Worker 배포 완료, Framer 연동 대기 중
- [인프라: Airtable 파이프라인](project_airtable_pipeline.md) — OCI→GDrive 싱크, schema.json 포맷, 클로드 워크스페이스 ID
- [인프라: 보유 인프라 현황](project_infrastructure.md) — OCI/GCloud/Cloudflare/Scriptable 조합 제안 기준
- [레퍼런스: Google Drive API](reference_google_drive_api.md) — OAuth 자격증명 위치, refresh token 재사용 방법
