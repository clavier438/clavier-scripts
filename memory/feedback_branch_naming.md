---
name: feedback_branch_naming
description: "브랜치 새로 만들어 작업 지시 시 기능 확정 전이면 틀린 이름 박지 말고 중립적 임시명으로, 기능 나오면 리네임"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9ab0720b-10a3-4b1c-ab54-2b96fc02ff29
---

"브랜치 새로 만들어 작업하자" 지시를 받았을 때, 기능명이 아직 확정되지 않았으면 **주변 단서로 추측한 이름을 박지 말 것**. 중립적 임시 이름(예: `wip`, `feat/tmp`)으로 만들고, 기능이 명확해지면 정식 이름으로 리네임한다.

**Why:** 미추적 scaffolding(`src/tenant/`)만 보고 `feat/multi-tenant`로 지었는데 실제 기능은 `branch*` 필드 평문 변환이었음 — 추측이 틀려 이름이 사실과 어긋났다. 형님이 지적한 핵심은 "느린 이름/추측 금지"가 아니라 **틀린 이름(사실과 다른 이름)을 적지 말라**는 것. 임시 이름 자체는 괜찮다.

**How to apply:** 기능 미확정 + 브랜치 지시 → 중립 임시명으로 생성 → 기능 확정 시 `git branch -m` 리네임. 단정적·구체적 이름은 사실 확인 후에만. [[feedback_ownership]] (추측으로 단정 짓지 말 것)와 같은 결.
