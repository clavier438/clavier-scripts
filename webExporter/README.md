# WebSiteExporter

Crawl any website and export every page as a full-scroll PDF — desktop, tablet, and mobile in one shot.

## What it does

Give it a URL. It finds all the pages, scrolls through each one to trigger lazy-load and animations, and exports a clean PDF grouped by viewport.

```bash
python webSiteExporter.py https://example.com --output ./out
```

Output: one PDF per site. Pages ordered desktop → tablet → mobile, landing page first.

## Why it's different

Most screenshot tools capture the visible area only. This one:

- **Scrolls the full page** — every lazy-loaded image, every scroll-triggered animation renders correctly
- **3 viewports in one run** — desktop (1440px), tablet (768px), mobile (390px) at 2x resolution
- **Crawls the whole site** — follows nav links automatically, up to a configurable page cap
- **Single PDF output** — no loose files to manage, everything in one document

## Install

```bash
pip install playwright pillow
playwright install chromium
```

## Usage

```bash
# Basic
python webSiteExporter.py https://example.com

# Custom output folder, limit to 20 pages
python webSiteExporter.py https://example.com -o ./exports -m 20

# Desktop only (skip tablet and mobile)
WEBEXP_SKIP_VIEWPORTS=tablet,mobile python webSiteExporter.py https://example.com

# Keep individual frame images
python webSiteExporter.py https://example.com --keep-frames
```

## Options

| Option | Default | Description |
|---|---|---|
| `--output, -o` | `./exports` | Output directory |
| `--max-pages, -m` | `50` | Max pages to capture (0 = no limit) |
| `--concurrency, -c` | `2` | Parallel URL processing |
| `--scroll-time, -s` | `60` | Scroll timeout in seconds |
| `--keep-frames` | off | Keep individual frame JPEGs after PDF build |

## Environment variables

| Variable | Description |
|---|---|
| `WEBEXP_SKIP_VIEWPORTS` | Comma-separated viewports to skip (e.g. `mobile` or `tablet,mobile`) |
| `WEBEXP_NAV_TOTAL_CAP` | Max nav links to follow |
| `WEBEXP_NAV_PREFIX_CAP` | Max detail pages per path prefix |
| `WEBEXP_URL_HARD_TIMEOUT_S` | Per-URL hard timeout in seconds (0 = auto by viewport count). Skips a page if it hangs instead of stalling the whole run |
| `WEBEXP_MEM_FLOOR_PCT` | Memory floor as % of total RAM (default 20). Restarts the browser when free memory drops below — works on both Linux and macOS |

## Output

```
exports/
  example-com.pdf    ← full site, all viewports, all pages
  example-com.log    ← execution log
```

## Requirements

- Python 3.9+
- Playwright (`pip install playwright && playwright install chromium`)
- Pillow (`pip install pillow`)

## 다운된 사이트 → Wayback Machine

라이브 사이트가 죽었거나(예: 가비아가 모든 경로를 `errdoc.gabia.io/403` 으로 302 redirect), 봇 차단(JA3 TLS fingerprint 등)으로 curl·playwright·실제 Chrome 모두 막히면 → Wayback 스냅샷으로 우회. (API 레퍼런스: [CDX Server](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server), [Availability](https://archive.org/help/wayback_api.php))

```bash
# 1. 스냅샷 인벤토리 — 어떤 페이지가 아카이브됐나 (collapse=urlkey 로 unique, statuscode:200 만)
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
