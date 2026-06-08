"""
뉴닉(newneek.co) 뉴스레터 아티클 스크래퍼
- 사이트맵에서 URL 목록 추출 → 개별 아티클 내용 수집
- ClaudeBot 허용 (robots.txt 확인)

Usage:
    python3 tools/newneek-scraper.py --output-dir <path> [--limit N]

Example:
    python3 tools/newneek-scraper.py \
        --output-dir ~/Library/Mobile\ Documents/com~apple~CloudDocs/0/works/asset/journalism-style-learning/newneek \
        --limit 100
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경(OCI 등)에서도 동작하게 선택적)
except ImportError:
    pass

import requests
from bs4 import BeautifulSoup

SITEMAP_URL = "https://newneek.co/sitemap/article-sitemap.xml"
BASE_URL = "https://newneek.co"
HEADERS = {
    "User-Agent": "ClaudeBot/1.0 (+https://claude.ai)",
    "Accept-Language": "ko-KR,ko;q=0.9",
}
REQUEST_DELAY = 0.8  # seconds between requests


def fetch_sitemap_urls(limit: int | None = None) -> list[str]:
    print(f"[sitemap] fetching {SITEMAP_URL}")
    resp = requests.get(SITEMAP_URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()

    root = ElementTree.fromstring(resp.content)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [el.text.strip() for el in root.findall(".//sm:loc", ns) if el.text]

    # filter to @newneek articles only
    urls = [u for u in urls if "/@newneek/article/" in u]
    print(f"[sitemap] found {len(urls)} @newneek articles")

    if limit:
        urls = urls[:limit]
        print(f"[sitemap] limited to {len(urls)}")
    return urls


def parse_article(url: str) -> dict | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [SKIP] {url} — {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # title
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else ""

    # published date — look for text pattern YYYY.MM.DD
    date_match = re.search(r"(\d{4}\.\d{2}\.\d{2})", resp.text)
    published = date_match.group(1) if date_match else ""

    # tags — look for anchor/span elements near category area
    tag_els = soup.select("a[href*='/search?tag='], span.tag, a.tag")
    tags = [t.get_text(strip=True) for t in tag_els if t.get_text(strip=True)]

    # body — collect h2 headings + paragraphs + lists in document order
    # Try article/main container first, fall back to body
    container = (
        soup.find("article")
        or soup.find("main")
        or soup.find("div", class_=re.compile(r"content|article|post|body", re.I))
        or soup.body
    )

    sections = []
    if container:
        for el in container.find_all(["h2", "h3", "p", "ul", "ol", "blockquote"]):
            text = el.get_text(separator=" ", strip=True)
            if text and len(text) > 5:
                sections.append({"tag": el.name, "text": text})

    # full plain text for quick analysis
    full_text = "\n\n".join(
        s["text"] for s in sections if s["tag"] in ("h2", "h3", "p", "blockquote")
    )

    # article ID from URL
    article_id = url.rstrip("/").split("/")[-1]

    return {
        "id": article_id,
        "url": url,
        "title": title,
        "published": published,
        "tags": tags,
        "sections": sections,
        "full_text": full_text,
        "scraped_at": datetime.now().isoformat(),
    }


def save(article: dict, output_dir: Path) -> None:
    fname = output_dir / f"{article['published'].replace('.', '-')}_{article['id']}.json"
    fname.write_text(json.dumps(article, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="뉴닉 아티클 스크래퍼")
    parser.add_argument(
        "--output-dir",
        required=True,
        help="저장 폴더 경로 (e.g. ~/Library/Mobile Documents/.../newneek)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="최대 수집 개수 (기본: 전체)",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"[output] {output_dir}")

    urls = fetch_sitemap_urls(args.limit)
    if not urls:
        print("[error] no URLs found")
        sys.exit(1)

    success, skip = 0, 0
    manifest = []

    for i, url in enumerate(urls, 1):
        article_id = url.rstrip("/").split("/")[-1]
        print(f"[{i}/{len(urls)}] {article_id} ...", end=" ", flush=True)

        article = parse_article(url)
        if article:
            save(article, output_dir)
            manifest.append({
                "id": article["id"],
                "url": article["url"],
                "title": article["title"],
                "published": article["published"],
                "tags": article["tags"],
            })
            print(f"✓ {article['title'][:40]}")
            success += 1
        else:
            skip += 1

        if i < len(urls):
            time.sleep(REQUEST_DELAY)

    # write manifest
    manifest_path = output_dir / "_manifest.json"
    manifest_path.write_text(
        json.dumps(
            {"scraped_at": datetime.now().isoformat(), "count": success, "articles": manifest},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\n[done] {success} saved, {skip} skipped → {output_dir}")
    print(f"[manifest] {manifest_path}")


if __name__ == "__main__":
    main()
