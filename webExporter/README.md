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
- **Asset extraction** — optionally pull every image, web font, and the brand color palette from each page (web swiss-army knife)

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
| `--download-images` | off | Download every image (img/srcset/background-image) → `images/<page>/` |
| `--download-fonts` | off | Download web fonts (@font-face woff/woff2/ttf/otf) → `fonts/<page>/` + `_loaded.txt` |
| `--extract-colors` | off | Extract rendered color palette (frequency-ranked) → `colors/<page>.json` + `.png` swatch |

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
