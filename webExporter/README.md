# webExporter

헤드리스 Playwright 로 URL 의 사이트맵을 크롤링하고 viewport (desktop / tablet / mobile) 별 풀페이지 스크롤 캡처를 streaming PDF 로 만든다. 단일 standalone 도구 (`webSiteExporter.py`).

## 사용법

```bash
# 단일 base — 자연 트리 nav 발견
python webSiteExporter.py https://example.com

# multi-URL — 첫 URL = base + 자연 nav 발견, 나머지 = 강제 add (자연 발견이 못 잡는 누락 페이지 보충용)
# 모두 같은 base PDF 1개로 합본 (한 폴더 / 한 PDF)
python webSiteExporter.py https://example.com https://example.com/missing-a https://example.com/missing-b

# URL 이 많으면 파일 + xargs
xargs python webSiteExporter.py --output ./out --max-pages 50 < urls.txt

# 출력 디렉터리 명시 (디폴트는 ./exports/<host>/ 자동)
python webSiteExporter.py https://example.com --output ./out
```

> ⚠ **zsh 함정**: `URLS=$(cat urls.txt); python … $URLS` 는 zsh 에서 URL 전체가 **1 덩어리**로 전달된다 (bash 와 달리 zsh 는 unquoted `$VAR` 를 word-split 안 함 → 발견 1페이지로 끝남). 여러 URL 은 **직접 나열**하거나 **`xargs`**(위) 또는 zsh 배열 `${(@f)URLS}` 로 넘길 것.

## 옵션

| 옵션 | 기본 | 의미 |
|---|---|---|
| `--output, -o` | `./exports/<host>/` | 출력 디렉터리 (미지정 시 base URL 호스트 기반 자동) |
| `--max-pages, -m` | `50` | 최대 페이지 수 (0 = cap 없음, 자연 트리: nav 전체 + 인덱스 전체 + 인덱스당 detail 3장) |
| `--concurrency, -c` | `2` | URL 동시 처리 수 |
| `--scroll-time, -s` | `60` | 스크롤 타임아웃 초 |
| `--keep-frames` | off | PDF 빌드 후 `frames/` 보존 (디폴트: 삭제) |

## 환경변수

| 변수 | 의미 |
|---|---|
| `WEBEXP_NAV_TOTAL_CAP` | nav 링크 전체 수 상한 |
| `WEBEXP_NAV_PREFIX_CAP` | prefix 별 detail 수 상한 |
| `WEBEXP_SKIP_VIEWPORTS` | skip 할 viewport (예: `mobile`) |
| `WEBEXP_URL_HARD_TIMEOUT_S` | per-URL 전체 watchdog 초 (0=viewport수 기반 auto). hang 시 그 URL 통째 skip |

## 출력

- `<output>/<site>.pdf` — 사이트 전체 단일 PDF. 뷰포트별 그룹 (desktop → tablet → mobile), 그룹 안에서 발견(랜딩→카테고리) 순서.
- `<output>/<site>.log` — 실행 로그 (stdout 와 동일 내용 자동 tee).
- `<output>/frames/*.jpg` — viewport 별 frame. **디폴트 삭제**, `--keep-frames` 로 보존.

`<site>` 슬러그는 base URL 전체 기반 (netloc+path) — 같은 도메인의 sub-path 진입점이 같은 디렉터리에 충돌 없이 공존.

## 자동 견고성 (2026-05-30~)

도구가 알아서 처리하는 것들 — 사용자가 신경 안 써도 됨:

- **SSL cert mismatch 자동 통과** (`ignore_https_errors`): 가비아 `*.gabia.io` 처럼 도메인 전용 cert 가 안 깔린 사이트도 진입. 디자인 스터디 캡처 목적상 cert 검증은 불필요.
- **per-URL hard watchdog**: 한 URL 이 어디서 hang 하든 (예: `ctx.close()` 무한대기) viewport 수 기반 timeout 초과 시 그 URL 통째 skip → browser 재시작(orphan 정리) → 다음 URL. 한 페이지의 hang 이 전체 작업을 멈추지 못함. `WEBEXP_URL_HARD_TIMEOUT_S` 로 override.
- viewport 단위 timeout: 페이지 로드 retry, `prepare_page` 60s, `capture` 120s (기존).

## 다운된 사이트 → Wayback Machine

라이브 사이트가 죽었거나(예: 가비아가 모든 경로를 `errdoc.gabia.io/403` 으로 302 redirect), 봇 차단(JA3 TLS fingerprint 등)으로 curl·playwright·실제 Chrome 모두 막히면 → Wayback 스냅샷으로 우회:

```bash
# 1. 스냅샷 인벤토리 — 어떤 페이지가 아카이브됐나 (collapse 로 unique, 200 만)
curl -s "https://web.archive.org/cdx/search/cdx?url=DOMAIN/*&output=json&collapse=urlkey&filter=statuscode:200&from=20210101"

# 2. 각 페이지의 최신 스냅샷 timestamp (미래 날짜 주면 closest=최신)
curl -s "https://archive.org/wayback/available?url=DOMAIN/PATH&timestamp=20251231"

# 3. if_ (Wayback toolbar 없는 raw 원본) URL 로 캡처. nav-cap 0 = archive 자체 nav 발견 방지.
#    URL 형식: https://web.archive.org/web/<TIMESTAMP>if_/http://DOMAIN/PATH/
WEBEXP_NAV_TOTAL_CAP=0 xargs python webSiteExporter.py --output ./out --max-pages 50 < wayback_urls.txt
```

- `if_` suffix = toolbar 제거된 원본 (없으면 archive UI 가 캡처에 끼어듦).
- 진단 순서: `curl -skv https://DOMAIN/`(SSL/redirect 확인) → `dig +short DOMAIN`(DNS) → 실제 Chrome(MCP) 진입 → 다 막히면 Wayback.

## 외부 호출자

- Mac → OCI: `tools/webexp.sh` (clavier-scripts) 가 OCI 에서 본 도구 실행 + Mac 으로 PDF pull
