---
name: Google Drive API 자격증명
description: 범용 Google Drive API OAuth 자격증명 — 필요할 때마다 재사용 가능
type: reference
originSessionId: c4863b1c-6a96-49cd-bb46-3035f778bbc1
---
Google Drive API가 필요한 작업에 재사용할 수 있는 OAuth 자격증명이 env.md에 있음.

- 위치: `env.md` → "API 키 / OAuth 자격증명" 섹션
- 항목: Client ID, Client Secret, Refresh Token
- scope: Drive 전체 (`https://www.googleapis.com/auth/drive`)
- 사용 예: Scriptable 스크립트, 서버 스크립트에서 `grant_type=refresh_token`으로 access token 발급
- 참고: 개인 Google Cloud 프로젝트(`loyal-venture-473812-b8`) 기반 — 제3자 서버 불필요
