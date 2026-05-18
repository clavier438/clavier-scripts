---
name: Git push 안전 원칙
description: 자동 push 시 remote가 앞서거나 분기 상태면 절대 push하지 말 것. force/overwrite 금지.
type: feedback
originSessionId: 55956c2d-7b56-4f9b-aeb5-e887aa0fe111
---
자동 push 시 remote가 시간상으로 앞서있거나 분기된 상태면 push 중단.

**Why:** 2026-05-14 포맷 후 watcherGitSync 켜기 전 사용자 명시. iCloud 동기화 지연 / 다른 환경(OCI, web)에서 commit 가능성 때문에 로컬이 항상 최신이라 가정 불가. 잘못 push하면 remote 작업 손실.

**How to apply:**
- `git fetch origin <branch>` 먼저 → ahead/behind 비교
- remote가 앞섬(behind) → 중단, 수동 pull 필요
- 분기(diverged) → 중단, 수동 merge 필요
- `--force` / `-f` push 절대 금지 (사용자 명시 요청 없으면)
- `gitSync.sh`에 이미 패치 적용됨 (2026-05-14)
