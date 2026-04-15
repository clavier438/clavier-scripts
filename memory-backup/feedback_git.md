---
name: 피드백: 깃 커밋 범위
description: git commit은 scripts 폴더 작업에 한정, 다른 폴더는 해당 없음
type: feedback
originSessionId: a05b5723-8989-45df-93b1-11047ec8bb16
---
scripts 폴더(`iCloud/0/scripts/`) 파일을 수정했을 때만 git commit을 남길 것. 다른 폴더 작업에는 적용하지 않는다.

**Why:** 깃 관리 대상이 scripts 폴더 하나뿐임. repo: `clavier0/clavier-scripts`
**How to apply:** scripts 폴더 파일 수정 → 커밋 필수. 그 외 폴더(~/bin, LaunchAgents 등) → 커밋 불필요.
커밋 메시지에는 무엇을, 왜 했는지 맥락 포함. "파일 수정" 같은 메시지 금지.
