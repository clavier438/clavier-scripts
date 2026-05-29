---
name: 피드백: Doppler/env 먼저 확인
description: API 키/토큰/시크릿 필요 시 Doppler 우선 (env.md 는 폐기 미러), 없을 때만 사용자에 물어봄
type: feedback
originSessionId: 679ea14a-3f84-49f9-8d72-e4b4078f96f8
---
API 키, 토큰, 비밀번호 등 env 성격의 값이 필요할 때는 **Doppler 를 먼저 확인** 하고, 거기 없을 때만 사용자에게 물어볼 것.

**2026-04-28 이후 SSOT 변경**: 이전 메모리는 `env.md` (iCloud) 우선이라 박혀있었으나 — 2026-04-28 DECISIONS ADR "시크릿 SSOT = Doppler" 이후 **Doppler 가 단일 진실 소스**. `env.md` 는 백업 미러로 강등 (Doppler 가 모름 의미). `doppler` 가 SSOT 인 현재 — env.md 직접 편집 금지 + Doppler 먼저.

**Why:** Doppler 에 주요 서비스(Airtable, GitHub, Cloudflare, Framer, SnapRender, Google OAuth 등)의 API 키와 토큰이 모두 정리되어 있다. 사용자가 매번 직접 알려주는 번거로움 + iCloud 미러 stale 위험 동시 해소.

**How to apply:**
1. 코드에 API 키 플레이스홀더가 있거나, 외부 서비스 연동이 필요할 때 → `doppler secrets` 먼저 실행 (해당 환경의 시크릿 목록 확인).
2. 특정 키 값 필요 시: `doppler run -- echo "$KEY_NAME"` 또는 `doppler secrets get KEY_NAME --plain` (실행 환경에서만).
3. 코드 안에서 사용 시: `process.env.KEY_NAME` / `os.environ["KEY_NAME"]` — `doppler run -- <cmd>` 가 자동 주입.
4. 키가 Doppler 에 없으면 → `clavier-config set KEY=VALUE` 로 사용자가 추가 (Doppler + iCloud 미러 자동 sync).
5. 마지막 fallback: env.md (gitignored 백업 미러). 직접 편집 금지.

**Auto-inject 트리거**: `tools/claude-hooks/user-prompt-submit.config.json` 의 `doppler` 도메인 keyword 매치 시 `tools/capabilities/doppler.md` 자동 주입. "API 키 알려주세요" 류 발화 전 — 사용자가 키워드 트리거 못 박을 때 — Claude 가 *능동적으로* `doppler secrets` 1회 호출 후 판단.

**Doppler CLI 핵심**:
- `doppler me` — 로그인 확인
- `doppler secrets` — 시크릿 목록 (마스킹)
- `doppler secrets get KEY --plain` — 값 가져오기 (실행 환경에서만 노출)
- `doppler run --project clavier --config prd -- <명령>` — 시크릿 주입 후 실행

**관련 메모리**: [[feedback_reference_class]] — Doppler CLI 사용 전 capability 파일 참조 (doppler.md). [[feedback_docs_first]] — 추측 X.
