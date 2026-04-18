---
name: 피드백: 깃 커밋 범위
description: git commit은 scripts 폴더 작업에 한정, 다른 폴더는 해당 없음
type: feedback
originSessionId: a05b5723-8989-45df-93b1-11047ec8bb16
---
scripts 폴더(`iCloud/0/scripts/`) 파일을 수정했을 때만 git commit을 남길 것. 다른 폴더 작업에는 적용하지 않는다.

**Why:** 깃 관리 대상이 scripts 폴더 하나뿐임. repo: `clavier0/clavier-scripts`
**How to apply:** scripts 폴더 파일 수정 → 커밋 필수. 그 외 폴더(~/bin, LaunchAgents 등) → 커밋 불필요.
커밋 메시지에는 **목적(왜)** 과 **수단(어떻게)** 을 반드시 함께 써라.
- 목적: 어떤 문제/필요 때문에 이 변경을 했나
- 수단: 그 목적을 위해 무엇을 어떻게 바꿨나
- ✅ `syncObsidian: 전체 rsync → 변경 파일 단건 처리 — Sana AI 동기화 시차 개선 목적`
- ❌ `syncObsidian 수정`, `파일 업데이트`

**Why:** 나중에 커밋 로그만 봐도 그 시점의 맥락과 판단 근거가 복원돼야 한다.
**How to apply:** 커밋 메시지 작성 전 "이 변경의 목적은 무엇인가 / 수단은 무엇인가"를 먼저 확인하고 둘 다 포함할 것.

**ARCHITECTURE.md 업데이트는 항상 세트:**
아키텍처가 바뀌는 작업(폴더 추가, 데몬 추가, 흐름 변경 등)을 할 때는
코드 변경 + ARCHITECTURE.md 업데이트 + git commit을 한 세트로 처리할 것.
ARCHITECTURE.md만 따로 커밋하지 말고, 관련 변경과 같은 커밋에 묶을 것.
