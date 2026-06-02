# site-scraper

Point it at a URL. Get the whole site back as clean, structured JSON + Markdown — every page, crawled and saved.

I kept needing whole websites as *data*, not screenshots — for migrations, archives, and feeding LLMs. The scrapers I tried were either SaaS with quotas or a pile of brittle code. So I built one that just works and gives me both machine-readable JSON and readable Markdown in one run.

## What it does

- Crawls a site to a depth you set, following links automatically
- Saves each page as `<page>.json` (structured) **and** `<page>.md` (readable)
- `_all.json` — every page in one array, ready for a dataset or RAG pipeline
- Optional image download, path-prefix scoping, polite crawling

## Install

```bash
pip3 install requests beautifulsoup4
```

## Usage

```bash
python3 site-scraper.py https://example.com
python3 site-scraper.py https://example.com -o ./out -d 3 -s /blog/ -i
```

Options: `-o` output dir · `-d` depth (default 3) · `-s` only paths under this prefix · `-i` also download images.

## Requirements

Python 3.9+. Runs on Mac and Linux.

---

*Honest heads-up: this is the tool I made for myself, cleaned up to share — not a polished SaaS with a support team. The real thing I use, priced low, for you to take and make your own.*
