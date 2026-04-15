---
name: 피드백: env.md에서 API 키/토큰 먼저 확인
description: API 키, 토큰, 비밀번호 등 env 성격의 값이 필요할 때는 env.md를 먼저 확인하고, 없을 때만 사용자에게 물어볼 것
type: feedback
originSessionId: 679ea14a-3f84-49f9-8d72-e4b4078f96f8
---
API 키, 토큰, 비밀번호 등 env 성격의 값이 필요할 때는 **먼저 env.md를 확인**하고, 거기 없을 때만 사용자에게 물어볼 것.

**Why:** env.md에 주요 서비스(Airtable, GitHub, OCI, SnapRender 등)의 API 키와 토큰이 모두 정리되어 있다. 사용자가 매번 직접 알려줘야 하는 번거로움을 없애기 위해 이 원칙을 만들었다.

**How to apply:** 코드에 API 키 플레이스홀더가 있거나, 외부 서비스 연동이 필요할 때 → 먼저 `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/env.md` 읽기 → 해당 서비스 섹션에서 키 찾기 → 없으면 사용자에게 물어보기.

**env.md 위치:** `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/env.md`
