# 2026-06-07 — 비전 분류 AI를 claude CLI 구독 빌링으로 통일 (lib/claude_cli.py 추출)

> 이 ADR 은 **repo-scoped (leaf)** — Layer 1 system ADR 아님.
> clavier-hq/DECISIONS.md 정식 박제 + doc-coverage 12-doc cascade **불요** (design-recon 도구 내부 변경, 전파 적소 = `DESIGN_RECON.md`).
> `docs/decisions/` 안에서 완결.

---

## 맥락

copy 도구(`copy.mjs`)는 LLM 호출을 **claude CLI(`claude -p`)** 로 한다 — OAuth 구독 빌링이라 별도 API 크레딧이 들지 않는다 (`tools/lib/copy/runner.mjs` `runClaude`). brandguide.py·photo-pattern.py 의 서술 생성도 같은 방식(파이썬 `run_claude` 복붙).

그런데 **image-tagger.py 의 비전 분류만 REST API 직접 호출**(`api.anthropic.com/v1/messages`, `x-api-key`=`ANTHROPIC_API_KEY`)로 남아 장당 크레딧을 태웠다. 사용자 결정: *"비전 분류에 필요한 AI도 copy 스크립트 방식을 따른다."*

두 문제가 겹쳤다:
1. **방식 불일치** — 같은 시스템이 LLM 을 두 경로(구독 CLI vs API 키)로 호출.
2. **복붙 중복** — `run_claude` 가 brandguide.py·photo-pattern.py 에 2벌. image-tagger 가 3번째를 만들 뻔 → `skills/reuse-first` 스킬 파생.

## 결정

**비전·LLM 호출을 `tools/lib/claude_cli.py` 단일 헬퍼로 통일하고, image-tagger 를 구독 빌링으로 전환한다.**

- `lib/claude_cli.py` = `copy/runner.mjs` 의 파이썬 짝. `run_claude(prompt, model, *, image_paths, json_schema)`:
  - **텍스트**: brandguide·photo-pattern 이 쓰던 그대로 (result 문자열).
  - **비전**: `image_paths=[abs]` → 프롬프트가 그 파일을 Read + `--allowedTools Read` (headless 멀티모달).
  - **구조화**: `json_schema` → `--json-schema`, `structured_output` 반환 (구 강제 `tool_choice` 대체).
  - `ANTHROPIC_API_KEY` 를 환경에서 떼고 호출 → 구독 인증 강제 (doppler 주입돼도 API 과금 0).
- brandguide.py·photo-pattern.py 의 복붙 `run_claude` 삭제 → `from claude_cli import run_claude`.
- image-tagger.py 의 `call_vision`(REST) 삭제 → `classify_photo`(claude_cli 재사용), `ANTHROPIC_API_KEY`·doppler 의존 제거.

## 검증

- **claude CLI(2.1.153) headless 비전 실측**: known-content PNG(파란 배경+노란 타원) → `"A bright yellow oval centered on a deep blue background."` (정확). ⚠ 디렉토리/존재하지 않는 경로를 주면 NO_VISION — 반드시 실재 파일 절대경로.
- **end-to-end**: `image-tagger.py <dir> --dry-run` → 4축 분류 + `--json-schema` structured_output 정상, `ANTHROPIC_API_KEY` 없이 작동.
- **단일화**: `brandguide`·`photo_pattern` 의 `run_claude.__module__ == 'claude_cli'` 확인.

## 전파 범위

- **적소**: `DESIGN_RECON.md` (보고서·툴킷·비용 단락) — image-tagger 비전 = claude CLI 구독 빌링.
- **12-doc cascade 불요**: design-recon 은 *수동 도구 파이프라인* 내부 변경 (STATUS 2026-06-05 brandguide ADR 와 동일 분류).
- 참고: **2026-06-15 부터 `claude -p` 가 구독의 별도 monthly Agent SDK 크레딧**을 쓴다 (여전히 구독 — 별도 API 충전 불요). 출처: https://code.claude.com/docs/en/headless 상단 공지.

## 잔여

- `--from-json` 우회 유지 — claude CLI 미인증 환경(OCI cron 등)에선 세션/subagent 가 분류 → JSON 주입. `memory/project_anthropic_key_no_credits`.
- `--bare` 모드는 금지 — OAuth 를 스킵하고 `ANTHROPIC_API_KEY` 를 요구해 구독 빌링이 깨진다 (docs 확인).
