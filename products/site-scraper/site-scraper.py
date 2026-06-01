#!/usr/bin/env python3
# site-scraper — 웹사이트 전체를 구조화 JSON + Markdown으로 수집
# 사용법: site-scraper <URL> [옵션]
#
# 옵션:
#   -o <디렉토리>   출력 디렉토리 (기본: ./scraped/<도메인>)
#   -d <깊이>       크롤 깊이 (기본: 3)
#   -s <접두사>     이 경로 아래만 수집 (예: /english/)
#   -i              이미지 파일도 다운로드
#   -h              도움말
#
# 출력:
#   <page>.json     구조화 데이터 (DB 설계 연습용)
#   <page>.md       사람이 읽기 편한 Markdown
#   images/         이미지 파일 (-i 옵션 시)
#   _all.json       전 페이지 통합 배열

import sys, os, re, time, argparse, urllib.parse, hashlib, json
from pathlib import Path
from collections import deque
from datetime import datetime, timezone


try:
    import requests
    from bs4 import BeautifulSoup, Tag
except ImportError:
    print("❌ 의존성 누락. 설치: pip3 install requests beautifulsoup4 --break-system-packages")
    sys.exit(1)

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; site-scraper/1.0)"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"}

# ── 메타 추출 ───────────────────────────────────────────────
def extract_meta(soup: BeautifulSoup, url: str) -> dict:
    def og(prop):
        t = soup.find("meta", property=f"og:{prop}")
        return t["content"] if t and t.get("content") else None
    def name_meta(n):
        t = soup.find("meta", attrs={"name": n})
        return t["content"] if t and t.get("content") else None
    return {
        "title":       soup.title.string.strip() if soup.title else None,
        "description": name_meta("description") or og("description"),
        "og_image":    og("image"),
        "og_type":     og("type"),
        "lang":        soup.html.get("lang") if soup.html else None,
        "canonical":   (soup.find("link", rel="canonical") or {}).get("href"),
    }

# ── 섹션 추출 ───────────────────────────────────────────────
def extract_sections(main: Tag, base_url: str) -> list:
    sections = []
    idx = 0

    # section / article / div[class] 단위로 분절
    blocks = main.find_all(["section", "article", "div"],
                            class_=True, recursive=False)
    if not blocks:
        blocks = [main]

    def get_images(node):
        imgs = []
        for img in node.find_all("img"):
            src = img.get("src", "")
            if src:
                imgs.append({
                    "src": urllib.parse.urljoin(base_url, src),
                    "alt": img.get("alt", ""),
                })
        return imgs

    def get_links(node):
        links = []
        for a in node.find_all("a", href=True):
            href = urllib.parse.urljoin(base_url, a["href"])
            text = a.get_text(strip=True)
            if text:
                links.append({"text": text, "href": href})
        return links

    def heading_level(node):
        for h in node.find_all(["h1","h2","h3","h4"]):
            return {"tag": h.name, "text": h.get_text(strip=True)}
        return None

    def body_text(node):
        for tag in node.find_all(["h1","h2","h3","h4","script","style","noscript"]):
            tag.decompose()
        return " ".join(node.get_text(" ", strip=True).split()) or None

    seen_texts = set()

    for block in blocks:
        # 중첩 section 재귀 방지 — 직접 자식 section 은 개별 처리
        for child_section in block.find_all("section", recursive=False):
            heading = heading_level(child_section)
            imgs    = get_images(child_section)
            lnks    = get_links(child_section)
            copy    = BeautifulSoup(str(child_section), "html.parser")
            body    = body_text(copy)
            key     = (heading.get("text") if heading else "") + (body or "")[:60]
            if key in seen_texts:
                continue
            seen_texts.add(key)
            if heading or body or imgs:
                sections.append({
                    "index":   idx,
                    "classes": " ".join(child_section.get("class", [])),
                    "heading": heading,
                    "body":    body,
                    "images":  imgs,
                    "links":   lnks,
                })
                idx += 1

        heading = heading_level(block)
        imgs    = get_images(block)
        lnks    = get_links(block)
        copy    = BeautifulSoup(str(block), "html.parser")
        body    = body_text(copy)
        key     = (heading.get("text") if heading else "") + (body or "")[:60]
        if key in seen_texts:
            continue
        seen_texts.add(key)
        if heading or body or imgs:
            sections.append({
                "index":   idx,
                "classes": " ".join(block.get("class", [])),
                "heading": heading,
                "body":    body,
                "images":  imgs,
                "links":   lnks,
            })
            idx += 1

    return sections

# ── 푸터 추출 ───────────────────────────────────────────────
def extract_footer(soup: BeautifulSoup, base_url: str) -> dict:
    footer = soup.find("footer") or soup.find(id=re.compile(r"footer", re.I))
    if not footer:
        return {}

    links = []
    for a in footer.find_all("a", href=True):
        href = urllib.parse.urljoin(base_url, a["href"])
        text = a.get_text(strip=True)
        if text:
            links.append({"text": text, "href": href})

    # SNS 구분
    social, nav_links = [], []
    social_domains = ("instagram", "facebook", "twitter", "youtube", "tiktok", "linkedin")
    for lnk in links:
        if any(s in lnk["href"] for s in social_domains):
            platform = next((s for s in social_domains if s in lnk["href"]), "other")
            social.append({"platform": platform, "url": lnk["href"]})
        else:
            nav_links.append(lnk)

    # 전화·주소·카피라이트
    text_full = footer.get_text(" ", strip=True)
    phone = re.search(r"[\d\-+\(\)]{8,}", text_full)
    copy  = re.search(r"©.*", text_full)

    return {
        "nav_links": nav_links,
        "social":    social,
        "phone":     phone.group() if phone else None,
        "copyright": copy.group() if copy else None,
        "raw_text":  " ".join(text_full.split())[:500],
    }

# ── Markdown 생성 ───────────────────────────────────────────
def to_markdown(page: dict) -> str:
    lines = [f"# {page['meta']['title'] or page['url']}",
             f"> Source: {page['url']}",
             f"> Scraped: {page['scraped_at']}", ""]

    for sec in page["sections"]:
        if sec["heading"]:
            lvl = int(sec["heading"]["tag"][1:])
            lines.append("#" * lvl + " " + sec["heading"]["text"])
        if sec["body"]:
            lines.append(sec["body"])
        for img in sec["images"]:
            lines.append(f"![{img['alt']}]({img['src']})")
        lines.append("")

    if page.get("footer"):
        f = page["footer"]
        lines += ["---", "## Footer"]
        if f.get("phone"):
            lines.append(f"**Phone**: {f['phone']}")
        if f.get("copyright"):
            lines.append(f"**Copyright**: {f['copyright']}")
        for lnk in f.get("nav_links", []):
            lines.append(f"- [{lnk['text']}]({lnk['href']})")
        for s in f.get("social", []):
            lines.append(f"- {s['platform']}: {s['url']}")

    return "\n".join(lines)

# ── URL → 파일명 ────────────────────────────────────────────
def url_to_slug(url: str) -> str:
    path = urllib.parse.urlparse(url).path.strip("/")
    if not path:
        return "index"
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", path).strip("_") or "index"

# ── 이미지 다운로드 ─────────────────────────────────────────
def download_image(url: str, img_dir: Path) -> bool:
    try:
        r = requests.get(url, headers=HEADERS, timeout=10, stream=True)
        r.raise_for_status()
        ext = Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"
        name = hashlib.md5(url.encode()).hexdigest()[:12] + ext
        (img_dir / name).write_bytes(b"".join(r.iter_content(8192)))
        return True
    except Exception:
        return False

# ── 단일 페이지 스크래핑 ────────────────────────────────────
def scrape_page(url: str, base_url: str, dl_images: bool, img_dir: Path) -> dict | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print(f"  ❌ {url}  ({e})")
        return None

    soup = BeautifulSoup(r.text, "html.parser")
    main = soup.select_one("main, #main, .page-content, article") or soup.body

    meta     = extract_meta(soup, url)
    sections = extract_sections(main, url)
    footer   = extract_footer(soup, url)

    if dl_images:
        all_imgs = [img["src"] for sec in sections for img in sec["images"]]
        for img_url in all_imgs:
            if Path(urllib.parse.urlparse(img_url).path).suffix.lower() in IMAGE_EXTS:
                download_image(img_url, img_dir)

    return {
        "url":        url,
        "slug":       url_to_slug(url),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "meta":       meta,
        "sections":   sections,
        "footer":     footer,
    }

# ── 크롤러 ──────────────────────────────────────────────────
def crawl(start_url: str, out_dir: Path, max_depth: int,
          dl_images: bool, scope: str):

    parsed      = urllib.parse.urlparse(start_url)
    origin      = f"{parsed.scheme}://{parsed.netloc}"
    scope_pfx   = scope or ""

    out_dir.mkdir(parents=True, exist_ok=True)
    img_dir = out_dir / "images"
    if dl_images:
        img_dir.mkdir(exist_ok=True)

    queue   = deque([(start_url, 0)])
    visited = set()
    all_pages = []
    img_count = 0

    print(f"\n🔍 크롤 시작: {start_url}")
    print(f"   출력: {out_dir}")
    if scope_pfx:
        print(f"   범위: {origin}{scope_pfx}*")
    print()

    while queue:
        url, depth = queue.popleft()
        if url in visited or depth > max_depth:
            continue
        visited.add(url)

        path = urllib.parse.urlparse(url).path
        if scope_pfx and not path.startswith(scope_pfx):
            continue

        page = scrape_page(url, origin, dl_images, img_dir)
        if not page:
            continue

        slug = page["slug"]
        n_sections = len(page["sections"])
        n_images   = sum(len(s["images"]) for s in page["sections"])
        if dl_images:
            img_count += n_images

        # JSON 저장
        json_path = out_dir / f"{slug}.json"
        json_path.write_text(json.dumps(page, ensure_ascii=False, indent=2),
                             encoding="utf-8")

        # Markdown 저장
        md_path = out_dir / f"{slug}.md"
        md_path.write_text(to_markdown(page), encoding="utf-8")

        all_pages.append(page)
        print(f"  ✅ {url}")
        print(f"     → {slug}.json  ({n_sections} sections, {n_images} images)")

        # 내부 링크 수집
        try:
            r2 = requests.get(url, headers=HEADERS, timeout=15)
            soup2 = BeautifulSoup(r2.text, "html.parser")
            for a in soup2.find_all("a", href=True):
                href = urllib.parse.urljoin(url, a["href"])
                p = urllib.parse.urlparse(href)
                clean = p._replace(fragment="").geturl()
                if p.netloc == parsed.netloc and clean not in visited:
                    queue.append((clean, depth + 1))
        except Exception:
            pass

        time.sleep(0.8)

    # 통합 JSON
    all_path = out_dir / "_all.json"
    all_path.write_text(json.dumps(all_pages, ensure_ascii=False, indent=2),
                        encoding="utf-8")

    total_sections = sum(len(p["sections"]) for p in all_pages)
    print(f"\n✨ 완료")
    print(f"   페이지: {len(all_pages)}개  |  섹션: {total_sections}개")
    if dl_images:
        print(f"   이미지: {img_count}개 → {img_dir}")
    print(f"   통합: {all_path}")

# ── CLI ─────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(
        prog="site-scraper",
        description="웹사이트 → 구조화 JSON + Markdown 수집 툴",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  site-scraper https://www.hana-mura.com/english/ -s /english/ -i
  site-scraper https://example.com -o ~/data -d 2
        """
    )
    p.add_argument("url")
    p.add_argument("-o", "--output", help="출력 디렉토리")
    p.add_argument("-d", "--depth",  type=int, default=3)
    p.add_argument("-i", "--images", action="store_true")
    p.add_argument("-s", "--scope",  default="")

    if len(sys.argv) == 1:
        p.print_help(); sys.exit(0)

    args = p.parse_args()
    out_dir = (Path(args.output).expanduser() if args.output
               else Path("./scraped") / urllib.parse.urlparse(args.url).netloc.replace("www.", ""))

    crawl(args.url, out_dir, args.depth, args.images, args.scope)

if __name__ == "__main__":
    main()
