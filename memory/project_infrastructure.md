---
name: 보유 인프라 현황
description: 사용자가 보유한 인프라 목록 — 제약 발생 시 적극적으로 조합 제안할 것
type: project
originSessionId: c4863b1c-6a96-49cd-bb46-3035f778bbc1
---
사용자는 아래 인프라를 이미 보유 중. 제약이나 한계가 보이면 먼저 제안할 것.

**Why:** 매번 "어떻게 할까요"가 아니라, Claude가 먼저 보유 리소스 기반으로 해결책을 제시해야 한다.
**How to apply:** 맥 의존성/서버 필요/데이터 연동/자동화 등 제약이 보이면 아래 인프라 조합을 먼저 검토하고 제안.

## OCI 서버
- 항상 켜진 Linux 서버, Claude Code 설치됨
- 데몬/스케줄러/장기 프로세스 적합
- 연결: `ociIn`

## Google Cloud (OAuth 발급 완료)
- credentials: env.md → "API 키 / OAuth 자격증명"
- Drive, Gmail, Calendar, Sheets, Cloud Functions 사용 가능
- scope 추가만으로 바로 연동

## Cloudflare Workers
- 엣지 실행, 무료 하루 10만 요청
- 웹훅/트리거/경량 API 서버 적합

## Scriptable (iOS)
- iPhone에서 JS 실행, iCloud 접근 + 외부 API 호출
- 단축어 연동으로 자동 트리거 가능

## 제안 기준
- 맥 꺼지면 안 됨 → OCI 또는 Scriptable
- 데이터 저장/연동 → Google API
- 웹훅/트리거 → Cloudflare Workers
- 새 자동화 → 위 조합 먼저 검토
