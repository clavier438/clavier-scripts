# 검증된 바퀴 카탈로그 (clavier-scripts)

> 이 목록은 *생성형으로 확인*하라 — 손으로 박은 카탈로그는 drift 한다. 아래 명령으로 현재 실재 목록을 먼저 뜨고, 그 다음 이 설명을 참조한다. (clavier "생성형 도면" 철학과 같은 자리.)
>
> ```bash
> for f in tools/lib/*.mjs tools/lib/*.py tools/lib/*.sh tools/lib/copy/*.mjs; do
>   echo "• ${f#tools/lib/}"; head -6 "$f" | grep -E '^(//|#)' | head -2; done
> ```

## 핵심 공유 바퀴 (`tools/lib/`)

| 바퀴 | 언어 | 무슨 일 | 언제 쓰나 |
|---|---|---|---|
| `repoPaths` | .mjs/.sh | sibling-first repo 탐색 (env > sibling) | clavier-hq·platform-workers 등 형제 repo 경로가 필요할 때. **절대경로 하드코딩 금지 — 무조건 이것.** |
| `freshness` | .mjs/.py/.sh | repo freshness 체크 (stale 클론 경고) | 도구 시작 시. 이미 41곳이 import — 새 도구도 따른다. |
| `cli-color` | .mjs | ANSI 색·볼드 helper | 터미널 출력. UX 백본 통일 — 직접 `\033[` 박지 말 것. |
| `doppler-wrap` | .mjs | Doppler self-respawn | 시크릿 필요한 .mjs 가 `doppler run` 없이 실행됐을 때 자기 재실행. |
| `airtable-api` | .mjs | Airtable REST wrapper (schema fetch + CRUD + 429 retry + 10-batch chunking) | Airtable 읽기/쓰기. 직접 fetch 금지 — 재시도·청킹이 여기 박혀 있다. |
| `airtable-input` | .mjs | 사용자 입력 normalization | Airtable 입력 정규화. |
| `airtable-upsert` | .mjs | idempotent CSV→base push (slugKey, 2-pass: fields → link resolve) | CSV 를 Airtable 에 멱등 upsert. |
| `workerEnvMap` | .mjs | 워커→Doppler config + wrangler env 매핑 (SSOT) | 워커별 config 가 필요할 때. |

## copy 서브시스템 (`tools/lib/copy/`) — front door = `copy.mjs`

| 바퀴 | 무슨 일 |
|---|---|
| `runner` | **claude CLI spawn** (`claude -p --system-prompt "" --output-format json`, user only, 구독 빌링·크레딧 0). ★ LLM/비전 호출은 이 패턴을 재사용 — `ANTHROPIC_API_KEY` 직접 호출 대신. |
| `menu` | workerCtl 스타일 인터랙티브 메뉴 (함수 메뉴 + 컨텍스트 변경) |
| `input-loader` | 숫자 이름 폴더 → 그 안 .md concat |
| `csv` | 멀티테이블 CSV 파싱/쓰기 (airtableCtl 호환) |
| `snapshot` | push 직전 영향받는 테이블 record 스냅샷 + diff preview |
| `airtable` | airtable adapter (URL parse · schema · records · PATCH/POST batch) |

## 알려진 중복 — 추출 후보 (살아있는 목록)

**파이썬 claude CLI 호출**: `run_claude(prompt, model)` 가 `tools/brandguide.py`·`tools/photo-pattern.py` 에 **복붙 2벌**. 둘 다:
```python
subprocess.run(["claude","-p","--system-prompt","","--output-format","json","--model",model,
                "--disallowed-tools","..."], input=prompt, capture_output=True, text=True, timeout=180)
```
→ `tools/lib/copy/runner.mjs` 의 파이썬 짝이다. **`tools/lib/claude_cli.py` 로 추출 대상.** 새 파이썬 도구가 claude CLI 를 부를 일이 생기면 *세 번째 복붙을 만들지 말고* 이 추출을 먼저 하라. (이 스킬의 탄생 계기 = image-tagger 비전 분류 마이그레이션.)

> 새 중복을 발견하면 여기 한 줄 추가하고, 추출이 끝나면 지운다. 비어 있는 게 건강한 상태.

## front door (verb 라우터) 패턴

사용자가 동사 하나로 쓰는 얇은 라우터 + 그대로 둔 내부 모듈:
- `brandRe.py` — capture / organize / tag / report / status / open → webExporter · recon · image-tagger · brandguide
- `copy.mjs` — csv / push / md / upsert → lib/copy/*
- `workerCtl.mjs`, `framer.mjs` — 동일 정신 (Cloudflare / Framer 측)

새 도구군이 모듈 여러 개로 나뉘면 이 패턴으로 front door 를 얹는다 — 모듈성은 그대로 두고 진입만 하나로.

## 코드 바깥 — 이미 가진 인프라 (CONVENTIONS.md "보유 인프라" 참조)

바퀴는 코드만이 아니다. 새 저장소·실행환경·시크릿 자리를 만들기 전에 이것들로 되는지 먼저 확인한다:
- **Doppler** — 시크릿 SSOT (`doppler run -- <명령>`). 새 .env 만들지 말 것.
- **OCI VM** (`ubuntu@168.107.63.94`) — 상주 실행환경.
- **Cloudflare Workers** — framer-sync 등 운영.
- **Google OAuth 앱** (발급 완료), **Airtable design base** — 이미 연결됨.

(상세는 `CONVENTIONS.md` L187 "보유 인프라 — 항상 먼저 떠올릴 것".)
