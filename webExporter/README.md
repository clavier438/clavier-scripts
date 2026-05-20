# webExporter

헤드리스 Playwright 로 URL 의 사이트맵을 크롤링하고 viewport (desktop / tablet / mobile) 별 풀페이지 스크롤 캡처를 streaming PDF 로 만든다. 단일 standalone 도구 (`webSiteExporter.py`).

## 사용법

```bash
python webSiteExporter.py https://example.com --output ./out
```

## 옵션

| 옵션 | 기본 | 의미 |
|---|---|---|
| `--output, -o` | `./exports` | 출력 디렉터리 |
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

## 출력

- `<output>/<site>.pdf` — 사이트 전체 단일 PDF. 뷰포트별 그룹 (desktop → tablet → mobile), 그룹 안에서 발견(랜딩→카테고리) 순서.
- `<output>/<site>.log` — 실행 로그 (stdout 와 동일 내용 자동 tee).
- `<output>/frames/*.jpg` — viewport 별 frame. **디폴트 삭제**, `--keep-frames` 로 보존.

`<site>` 슬러그는 base URL 전체 기반 (netloc+path) — 같은 도메인의 sub-path 진입점이 같은 디렉터리에 충돌 없이 공존.

## 외부 호출자

- Mac → OCI: `tools/webexp.sh` (clavier-scripts) 가 OCI 에서 본 도구 실행 + Mac 으로 PDF pull
