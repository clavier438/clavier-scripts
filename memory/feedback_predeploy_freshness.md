---
name: feedback_predeploy_freshness
description: platform-workers 분기·배포 전 로컬 main이 origin/main과 동기인지 먼저 확인
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 41db8c8c-4f83-4aee-bd43-03c2cb48799a
---

platform-workers 에서 새 브랜치를 따거나 배포하기 전에 **로컬 main 이 origin/main 과 같은 commit 인지 먼저 확인**한다. 분기는 항상 `origin/main` 기준으로 (`git fetch origin` → `git checkout -b x origin/main`), 배포 직전 로컬 HEAD == origin/main 확인.

**Why:** 2026-06-02 세션에서 로컬 main 이 origin/main 보다 18 커밋 뒤처져 있었다. 그 stale main 으로 분기해 mukayu 에 배포했다면 최근 18 커밋(stage1 _order 수정 등)을 되돌리는 회귀 배포가 될 뻔했다. package.json version(2.0.0)이 워커 /status version(2.3.0)과 달라 우연히 눈치챘다 — 항상 운이 좋은 건 아니다.

**How to apply:** 작업 시작 시 `git fetch origin`. 분기/리셋 베이스는 로컬 main 이 아니라 `origin/main`. 배포 직전 `git rev-parse main origin/main` 일치 확인, 불일치면 먼저 fast-forward. [[feedback_deploy_workflow]]
