---
name: 피드백: 문서 역할 분담 원칙
description: 어떤 정보를 어디에 두는지 역할 분담 — 이 원칙대로 유지하고 다른 곳에 중복하지 말 것
type: feedback
originSessionId: 60429ae2-ed16-4953-9c3b-be57e431ce36
---
## 역할 분담

| 위치 | 담당 내용 |
|------|----------|
| `ARCHITECTURE.md` (각 repo) | 해당 모듈의 구조, 설계 의도, 다른 모듈과의 연결점 |
| git log / commit message | 무엇이 바뀌었는지, 다음 작업이 무엇인지 |
| `~/.claude/memory/` | Claude 행동지침만 (이 파일처럼) |

## 핵심 원칙

- **ARCHITECTURE.md = 시스템 사실 정보의 단일 소스.** repo마다 독립적으로 자기 모듈을 기술하고, 전체 그림은 각 모듈을 조합하면 나온다.
- **PROGRESS.md는 사용하지 않는다.** 진행 상황은 커밋 메시지로, 구조는 ARCHITECTURE.md로 충분하다.
- **memory에 시스템 사실 정보를 중복하지 않는다.** repo 목록, 서버 주소, 경로 등은 ARCHITECTURE.md에만.
- **커밋 메시지에 "다음 세션 시작점"을 명시한다.** 복잡한 작업이 중단될 때는 커밋 메시지 body에 다음 작업을 적어둔다.

**Why:** 하나를 바꾸면 엮인 모든 곳을 고쳐야 하는 문제를 없애기 위해. 각 정보는 딱 한 곳에만 존재해야 한다.

**How to apply:**
- 작업 후 ARCHITECTURE.md만 업데이트하면 충분 (PROGRESS.md, memory 중복 업데이트 불필요)
- 세션 시작 시: 관련 repo의 ARCHITECTURE.md + `git log --oneline -10`으로 컨텍스트 복구
- memory에 새 항목을 추가하려 할 때: "행동지침인가, 사실 정보인가" 먼저 확인 — 사실 정보면 ARCHITECTURE.md로

## 예외: 에코시스템 수준 굵직한 메모리

프로젝트 독립적 행동지침이 원칙이지만, **일 전반에서 비중이 높고 반복적으로 등장하는 핵심 인프라/플랫폼**에 대해서는 아키텍처적 통찰, 제안 패턴, 창의적 조합 아이디어를 메모리에 저장한다.

대상 에코시스템: Framer, Airtable, Cloudflare Workers, OCI, Google Cloud (Cloud Functions / Edge / AI Studio), Sana AI

**Why:** 이 인프라들은 모든 프로젝트에 반복적으로 등장하며, 조합 방식에 대한 누적 인사이트가 있어야 Claude가 먼저 "이렇게도 할 수 있다"를 제안할 수 있다.

**How to apply:** 새로운 아키텍처 패턴이나 조합 아이디어를 발견하면 `project_ecosystem_architecture.md`에 추가. Claude가 먼저 꺼낼 것 — 사용자가 물어보길 기다리지 말 것.
