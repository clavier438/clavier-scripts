---
name: project_anthropic_key_no_credits
description: "Doppler ANTHROPIC_API_KEY 잔액 부족 — 비전/LLM API 직접호출 도구는 막힘, 세션/subagent로 우회"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7c2d1d54-7751-4cf8-8a88-474467fed8d2
---

2026-06 기준, Doppler `ANTHROPIC_API_KEY`(유효·108자)가 가리키는 Anthropic 계정의 **크레딧 잔액이 부족**하다. `/v1/messages` 직접 호출 시 `HTTP 400 "Your credit balance is too low to access the Anthropic API"`.

**Why:** 외부 Node/Python 에서 Claude API 를 직접 부르는 도구(예: `clavier-scripts/tools/image-tagger.py` 의 비전 분류 경로)가 즉시 막힌다. 코드는 정상이어도 결제에서 멈춘다.

**How to apply:**
- 새 비전/LLM 도구는 항상 **우회 경로를 함께** 둔다 — 이 세션의 Claude 또는 subagent(Agent 도구)가 직접 이미지를 보고 분류한 결과를 `--from-json` 식으로 주입받아 처리(구독 빌링이라 별도 크레딧 불필요).
- 대량 자동화(수백~수천 장)가 필요하면, 무작정 API 경로를 돌리지 말고 사용자에게 **크레딧 충전 또는 펀딩된 다른 키**를 먼저 요청. 충전되면 API 경로로 전환.
- 상태는 변할 수 있음 — 다음에 필요할 때 잔액 재확인. 관련: [[project_airtable_pipeline]] 류 env/Doppler 확인 습관과 동일선상.
