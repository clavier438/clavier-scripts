"""
Website PDF Exporter
- WebKit 엔진, page.pdf() → 세로 긴 PDF 한 장
- 뷰포트 3개 병렬, URL 3개 동시 처리
"""
import argparse, asyncio, os, plistlib, re, subprocess, sys
from urllib.parse import urlparse
from playwright.async_api import async_playwright

# ── 설정 ──────────────────────────────────────────────────
VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "tablet":  {"width": 768,  "height": 1024},
    "mobile":  {"width": 390,  "height": 844},
}
TAGS = {
    "desktop": ["web", "desktop"],
    "tablet":  ["web", "tablet"],
    "mobile":  ["web", "mobile"],
}
VIEWPORT_CONFIGS  = list(VIEWPORTS.items())
URL_CONCURRENCY   = 3
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB2PDF_BIN = os.path.join(SCRIPT_DIR, "web2pdf", ".build", "release", "web2pdf")


# ── 유틸 ──────────────────────────────────────────────────
def set_finder_tags(filepath: str, tags: list):
    plist = plistlib.dumps(tags, fmt=plistlib.FMT_BINARY)
    subprocess.run(
        ["xattr", "-wx", "com.apple.metadata:_kMDItemUserTags", plist.hex(), filepath],
        capture_output=True,
    )

def sanitize_filename(url: str) -> str:
    p = urlparse(url)
    name = p.netloc + p.path
    name = re.sub(r"[^\w\-.]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_.")
    return name or "index"


# ── 스크롤 (discover_pages용) ─────────────────────────────
async def auto_scroll(page, max_scroll_time: int = 30):
    """버퍼형 스크롤: 바닥까지 점프 반복, height 변화 없으면 종료."""
    await page.evaluate(
        """
        async (maxTime) => {
            const start = Date.now();
            let lastHeight = 0;
            let sameCount = 0;

            while (Date.now() - start < maxTime * 1000) {
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(r => setTimeout(r, 800));
                const newHeight = document.body.scrollHeight;
                if (newHeight === lastHeight) {
                    sameCount++;
                } else {
                    sameCount = 0;
                }
                lastHeight = newHeight;
                if (sameCount >= 4) break;
            }
            window.scrollTo(0, 0);
        }
        """,
        max_scroll_time,
    )



# ── 페이지 탐색 ───────────────────────────────────────────
async def discover_pages(page, base_url: str, max_pages: int = 0) -> list:
    """
    탐색 전략:
      1. base URL → <nav>/<header> 링크 = 메인 섹션 페이지
      2. 각 메인 섹션 페이지 → 콘텐츠 영역 링크 최대 5개 = 디테일 페이지
    nav/header/footer 링크는 디테일로 중복 수집하지 않음.
    """
    base_domain = urlparse(base_url).netloc
    SKIP_EXT = {
        ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg",
        ".mp4", ".mp3", ".doc", ".docx", ".xls", ".xlsx",
    }
    DETAIL_PER_NAV = 5

    seen      = set()
    ordered   = []

    def clean_url(href: str) -> str | None:
        p = urlparse(href)
        if p.netloc != base_domain:
            return None
        if any(p.path.lower().endswith(e) for e in SKIP_EXT):
            return None
        u = f"{p.scheme}://{p.netloc}{p.path}"
        if p.query:
            u += f"?{p.query}"
        return u.rstrip("/")

    def add(url: str) -> bool:
        if url and url not in seen:
            seen.add(url)
            ordered.append(url)
            return True
        return False

    add(base_url.rstrip("/"))

    # ── Step 1: base URL 방문 → nav/header 링크 수집 ──────
    nav_pages = []
    try:
        await page.goto(base_url, wait_until="domcontentloaded", timeout=60000)
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await auto_scroll(page)

        nav_hrefs = await page.evaluate("""
            () => [...new Set(
                [...document.querySelectorAll(
                    'nav a[href], header a[href], [role="navigation"] a[href]'
                )].map(a => a.href)
            )]
        """)
        for href in nav_hrefs:
            u = clean_url(href)
            if u and add(u):
                nav_pages.append(u)
    except Exception as e:
        print(f"  [WARNING] base URL 탐색 오류: {e}")

    # ── Step 2: 각 nav 페이지 → 콘텐츠 영역 디테일 링크 5개 ──
    for nav_url in nav_pages:
        try:
            await page.goto(nav_url, wait_until="domcontentloaded", timeout=60000)
            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
            await auto_scroll(page)

            content_hrefs = await page.evaluate("""
                () => {
                    // nav/header/footer 링크는 제외
                    const excluded = new Set(
                        [...document.querySelectorAll(
                            'nav a, header a, [role="navigation"] a, footer a'
                        )].map(a => a.href)
                    );
                    const root = document.querySelector(
                        'main, [role="main"], #content, .content, article'
                    ) || document.body;
                    return [...root.querySelectorAll('a[href]')]
                        .map(a => a.href)
                        .filter(h => !excluded.has(h));
                }
            """)

            count = 0
            for href in content_hrefs:
                if count >= DETAIL_PER_NAV:
                    break
                u = clean_url(href)
                if u and add(u):
                    count += 1

        except Exception as e:
            print(f"  [WARNING] nav 페이지 탐색 오류 ({nav_url}): {e}")

    print(f"  발견: base(1) + nav({len(nav_pages)}) + detail({len(ordered)-1-len(nav_pages)}) = {len(ordered)}페이지")
    return ordered


# ── 단일 뷰포트 익스포트 (web2pdf subprocess) ────────────
async def export_viewport(url: str, vp_name: str,
                          vp_size: dict, output_dir: str, scroll_time: int) -> bool:
    filename = f"{sanitize_filename(url)}-{vp_name}.pdf"
    filepath = os.path.join(output_dir, filename)

    try:
        proc = await asyncio.create_subprocess_exec(
            WEB2PDF_BIN, url,
            "--width",       str(vp_size["width"]),
            "--output",      filepath,
            "--timeout",     "120",
            "--scroll-time", str(scroll_time),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode == 0:
            out = stdout.decode().strip()
            print(f"  {out}  tags: {TAGS[vp_name]}")
            set_finder_tags(filepath, TAGS[vp_name])
            return True
        else:
            err = stderr.decode().strip()
            print(f"  ✗ 실패 ({vp_name}): {err}")
            return False
    except Exception as e:
        print(f"  ✗ 실패 ({vp_name}): {e}")
        return False


# ── URL 하나 처리 (3개 뷰포트 병렬) ─────────────────────
async def export_url(url: str, output_dir: str,
                     scroll_time: int, sem: asyncio.Semaphore):
    async with sem:
        tasks = [
            export_viewport(url, vp_name, vp_size, output_dir, scroll_time)
            for vp_name, vp_size in VIEWPORT_CONFIGS
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        ok   = sum(1 for r in results if r is True)
        fail = sum(1 for r in results if r is not True)
        return ok, fail


# ── 메인 ──────────────────────────────────────────────────
async def run(base_url: str, output_dir: str, max_pages: int, scroll_time: int):
    os.makedirs(output_dir, exist_ok=True)

    if not os.path.exists(WEB2PDF_BIN):
        print(f"[ERROR] web2pdf 바이너리 없음: {WEB2PDF_BIN}")
        print("  cd web2pdf && swift build -c release")
        sys.exit(1)

    # Playwright — 페이지 탐색 전용
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context()
        pg  = await ctx.new_page()
        pages = await discover_pages(pg, base_url, max_pages)
        await ctx.close()
        await browser.close()

    print(f"발견된 페이지: {len(pages)}개")
    for i, u in enumerate(pages, 1):
        print(f"  {i}. {u}")
    print(f"\n익스포트 시작 (총 {len(pages) * 3}개, "
          f"URL {URL_CONCURRENCY}개 동시 × 뷰포트 3개)\n")

    sem = asyncio.Semaphore(URL_CONCURRENCY)
    all_results = await asyncio.gather(*[
        export_url(url, output_dir, scroll_time, sem)
        for url in pages
    ])

    total_ok   = sum(ok   for ok, _   in all_results)
    total_fail = sum(fail for _, fail in all_results)
    print(f"\n완료!  성공: {total_ok} / 실패: {total_fail}")
    print(f"출력: {os.path.abspath(output_dir)}")


# ── CLI ───────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Website JPG Exporter")
parser.add_argument("url",                                help="기준 URL (https://...)")
parser.add_argument("--output",      "-o", default="./jpg_exports", help="출력 디렉터리")
parser.add_argument("--max-pages",   "-m", type=int, default=50,    help="최대 페이지 수")
parser.add_argument("--scroll-time", "-s", type=int, default=60,    help="스크롤 타임아웃(초)")
args = parser.parse_args()

if not urlparse(args.url).scheme:
    print("[ERROR] URL에 https:// 를 포함해주세요")
    sys.exit(1)

asyncio.run(run(args.url, args.output, args.max_pages, args.scroll_time))
