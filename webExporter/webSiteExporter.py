"""
Website Layout Exporter (Option C)
- Chromium + Playwright
- 브레이크포인트 3개(desktop/tablet/mobile), device_scale=3
- 페이지 탐색(nav → detail)
- 각 URL × 각 뷰포트:
    - 쿠키/팝업 제거
    - lazy-load 무력화
    - 끝까지 스크롤 + img.decode()
    - 비디오 첫 프레임 렌더
    - 폰트/페인트 버퍼
    - 짧은 페이지: WebP lossless 한 장
    - 긴 페이지: PNG 여러 장 캡처 후 세로 스티칭 → PNG 한 장
- URL 3개 동시 처리, 각 URL 안에서 뷰포트 3개 순차 처리
"""

import argparse
import asyncio
import os
import plistlib
import re
import subprocess
import sys
from urllib.parse import urlparse

from PIL import Image
from playwright.async_api import async_playwright

Image.MAX_IMAGE_PIXELS = None  # 대형 이미지 경고 억제

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
VIEWPORT_CONFIGS = list(VIEWPORTS.items())

URL_CONCURRENCY = 3
DEVICE_SCALE    = 3
WEBP_MAX        = 16383
CHUNK_MAX       = 16000

# ── 유틸 ──────────────────────────────────────────────────
def set_finder_tags(filepath: str, tags: list):
    try:
        plist = plistlib.dumps(tags, fmt=plistlib.FMT_BINARY)
        subprocess.run(
            ["xattr", "-wx", "com.apple.metadata:_kMDItemUserTags", plist.hex(), filepath],
            capture_output=True,
        )
    except Exception as e:
        print(f"[WARN] Finder 태그 설정 실패: {filepath} ({e})")

def sanitize_filename(url: str) -> str:
    p = urlparse(url)
    name = p.netloc + p.path
    name = re.sub(r"[^\w\-.]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_.")
    return name or "index"

def log(msg: str):
    print(msg, flush=True)

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
    base_domain = urlparse(base_url).netloc
    SKIP_EXT = {
        ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg",
        ".mp4", ".mp3", ".doc", ".docx", ".xls", ".xlsx",
    }
    DETAIL_PER_NAV = 5

    seen    = set()
    ordered = []

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
        log(f"  [WARN] base URL 탐색 오류: {e}")

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
                if max_pages and len(ordered) >= max_pages:
                    break
                if count >= DETAIL_PER_NAV:
                    break
                u = clean_url(href)
                if u and add(u):
                    count += 1

        except Exception as e:
            log(f"  [WARN] nav 페이지 탐색 오류 ({nav_url}): {e}")

    if max_pages:
        ordered = ordered[:max_pages]

    log(f"  발견: base(1) + nav({len(nav_pages)}) + detail({len(ordered)-1-len(nav_pages)}) = {len(ordered)}페이지")
    return ordered

# ── 페이지 전처리 ──────────────────────────────────────────
async def prepare_page(page):
    # 1) 페이지 안정화 대기 (쿠키 배너 등장 시간 확보)
    await asyncio.sleep(2)

    # 2) OneTrust / Optanon API 호출
    await page.evaluate(
        """
        () => new Promise(resolve => {
            let tries = 0;
            const poll = setInterval(() => {
                try {
                    if (window.OneTrust && typeof OneTrust.AllowAll === 'function') {
                        OneTrust.AllowAll(); clearInterval(poll); resolve(); return;
                    }
                    if (window.Optanon && typeof Optanon.AllowAll === 'function') {
                        Optanon.AllowAll(); clearInterval(poll); resolve(); return;
                    }
                } catch (e) {}
                if (++tries > 25) { clearInterval(poll); resolve(); }
            }, 200);
        })
        """
    )

    # 3) Cookiebot ID 기반 클릭
    await page.evaluate(
        """
        () => {
            const ids = [
                'CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                'CybotCookiebotDialogBodyButtonAccept'
            ];
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el) { try { el.click(); } catch(e) {} }
            }
        }
        """
    )

    # 4) 버튼 텍스트 매칭 클릭
    await page.evaluate(
        """
        () => {
            const TEXTS = new Set([
                'accept all','accept cookies','allow all','allow all cookies',
                'agree','agree to all','i agree','got it','ok','okay',
                '동의','허용','모두 수락','모두 허용'
            ]);
            for (const btn of document.querySelectorAll('button,[role="button"],a[role="button"]')) {
                const t = (btn.innerText || '').trim().toLowerCase();
                if (TEXTS.has(t) && btn.offsetParent !== null) {
                    try { btn.click(); } catch(e) {}
                }
            }
        }
        """
    )

    await asyncio.sleep(1)

    # 5) 배너 DOM 강제 제거 + CSS 강제 숨김 + overflow 해제
    await page.evaluate(
        """
        () => {
            // CSS로 fixed/sticky 오버레이 전부 숨김
            const style = document.createElement('style');
            style.setAttribute('data-exporter-hide', 'true');
            style.textContent = `
                [id*="cookie"i], [id*="consent"i], [id*="gdpr"i],
                [id*="onetrust"i], [id*="cookiebot"i],
                [class*="cookie"i], [class*="consent"i], [class*="gdpr"i],
                [class*="cc-window"i], [class*="cookie-banner"i],
                [role="dialog"], [role="alertdialog"] {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
            `;
            document.head.appendChild(style);

            // DOM 제거 (position fixed/absolute/sticky인 것)
            const sels = [
                '#onetrust-consent-sdk','#onetrust-banner-sdk','.onetrust-pc-dark-filter',
                '#CybotCookiebotDialog','.cc-window','.cookie-banner',
                '[class*="cookie"],[class*="consent"],[class*="gdpr"]',
                '[class*="modal"],[class*="popup"],[class*="overlay"]',
                '[class*="banner"],[class*="dialog"]',
                '[id*="cookie"],[id*="modal"],[id*="popup"]',
                '[role="dialog"],[role="alertdialog"]'
            ];
            for (const sel of sels) {
                document.querySelectorAll(sel).forEach(el => {
                    try {
                        const s = getComputedStyle(el);
                        if (['fixed','absolute','sticky'].includes(s.position)) el.remove();
                    } catch(e) {}
                });
            }

            // overflow 해제
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            document.body.style.position = '';
        }
        """
    )

    # 6) lazy-load 무력화
    await page.evaluate(
        """
        () => {
            document.querySelectorAll('img[loading="lazy"]').forEach(img => {
                img.loading = 'eager';
            });
            document.querySelectorAll('img[data-src],img[data-lazy],img[data-original]').forEach(img => {
                const src = img.dataset.src || img.dataset.lazy || img.dataset.original;
                if (src && !img.src) img.src = src;
            });
        }
        """
    )

    # 7) 끝까지 스크롤 (버퍼형, 최대 90초)
    await page.evaluate(
        """
        async () => {
            const start = Date.now();
            let lastHeight = 0;
            let sameCount = 0;

            while (Date.now() - start < 90 * 1000) {
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(r => setTimeout(r, 1000));
                const newHeight = document.body.scrollHeight;
                if (newHeight === lastHeight) sameCount++;
                else sameCount = 0;
                lastHeight = newHeight;
                if (sameCount >= 5) break;
            }
            // 한 번 더 바닥 확인
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(r => setTimeout(r, 2000));
            window.scrollTo(0, 0);
        }
        """
    )

    # 7.5) 푸터까지 확실히 내려갔다 오기
    await page.evaluate(
        """
        async () => {
            const footer =
                document.querySelector('footer, [role="contentinfo"]') ||
                document.querySelector('#footer, .footer, .site-footer');

            if (footer) {
                footer.scrollIntoView({ behavior: 'instant', block: 'end' });
                await new Promise(r => setTimeout(r, 2000));
            }

            // 혹시 남은 lazy-load를 위해 한 번 더 바닥으로
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(r => setTimeout(r, 2000));

            // 캡처는 항상 맨 위에서
            window.scrollTo(0, 0);
        }
        """
    )

    # 8) 이미지 decode 대기
    await page.evaluate(
        """
        () => Promise.all(
            [...document.querySelectorAll('img')].map(img => {
                if (!img.src || img.src.startsWith('data:')) return Promise.resolve();
                if (img.naturalWidth > 0 && img.complete) {
                    return img.decode().catch(() => {});
                }
                return new Promise(resolve => {
                    img.onload = () => img.decode().then(resolve).catch(resolve);
                    img.onerror = resolve;
                    setTimeout(resolve, 15000);
                });
            })
        )
        """
    )

    # 9) 비디오: src 강제 설정 → load() → 첫 프레임 시크
    await page.evaluate(
        """
        async () => {
            const videos = [...document.querySelectorAll('video')];

            // src 주입
            for (const v of videos) {
                try {
                    const lazySrc = v.dataset.src || v.dataset.lazy
                                  || v.dataset.videoSrc || v.dataset.url;
                    if (lazySrc && !v.currentSrc) v.src = lazySrc;

                    // <source> 태그 활성화
                    for (const s of v.querySelectorAll('source')) {
                        const dataSrc = s.dataset.src || s.dataset.lazy;
                        if (dataSrc && !s.src) s.src = dataSrc;
                    }

                    v.removeAttribute('data-src');
                    v.muted    = true;
                    v.preload  = 'auto';
                    v.autoplay = false;
                } catch(e) {}
            }

            // 로드 + 첫 프레임
            await Promise.all(
                videos.map(v => new Promise(resolve => {
                    if (v.readyState >= 2) {
                        try { v.currentTime = 0.001; } catch(e) {}
                        resolve(); return;
                    }
                    const done = () => {
                        try { v.currentTime = 0.001; v.pause(); } catch(e) {}
                        resolve();
                    };
                    v.addEventListener('canplay',    done,    { once: true });
                    v.addEventListener('loadeddata', done,    { once: true });
                    v.addEventListener('error',      resolve, { once: true });
                    try { v.load(); } catch(e) {}
                    setTimeout(resolve, 12000);
                }))
            );
        }
        """
    )

    # 10) 폰트 + 페인트 버퍼
    try:
        await page.evaluate("document.fonts && document.fonts.ready || Promise.resolve()")
    except Exception:
        pass
    await page.evaluate(
        "() => new Promise(r => { requestAnimationFrame(() => requestAnimationFrame(r)); })"
    )
    await asyncio.sleep(3)

# ── 캡쳐 로직 ────────────────────────────────────────────
CHUNK_MAX = 16000  # 한 조각의 실제 픽셀 높이 (안전 여유)

async def capture_viewport(page, vp_name: str, vp_conf: dict, output_dir: str, base_name: str) -> str:
    os.makedirs(output_dir, exist_ok=True)
    width = vp_conf["width"]

    css_height    = await page.evaluate("document.body.scrollHeight")
    scaled_height = css_height * DEVICE_SCALE

    log(f"  [{vp_name}] css_height={css_height}px  scaled={scaled_height}px")

    # 1) 전체를 PNG로 한 번 캡처 (임시 파일)
    tmp_png = os.path.join(output_dir, f"{base_name}-{vp_name}-tmp.png")
    await page.screenshot(path=tmp_png, full_page=True, type="png")

    img = Image.open(tmp_png)

    # ── 케이스 1: 짧은 페이지 → WebP 한 장 ─────────────────
    if scaled_height <= WEBP_MAX:
        out_webp = os.path.join(output_dir, f"{base_name}-{vp_name}.webp")
        img.save(out_webp, "WEBP", lossless=True, quality=100)
        img.close()
        os.remove(tmp_png)

        kb = os.path.getsize(out_webp) // 1024
        log(f"  ✓ {os.path.basename(out_webp)}  ({width}×{css_height}px)  {kb}KB  [WebP]")
        return out_webp

    # ── 케이스 2: 긴 페이지 → WebP 여러 장 + PDF ─────────────
    log(f"  [{vp_name}] LONG PAGE → split WebP + PDF")

    parts_webp = []
    total_h    = img.height
    chunk_px   = CHUNK_MAX
    y = 0
    idx = 0

    while y < total_h:
        h    = min(chunk_px, total_h - y)
        crop = img.crop((0, y, img.width, y + h))
        part_webp = os.path.join(output_dir, f"{base_name}-{vp_name}-part-{idx}.webp")
        crop.save(part_webp, "WEBP", lossless=True, quality=100)
        parts_webp.append(part_webp)
        crop.close()
        y   += h
        idx += 1

    img.close()
    os.remove(tmp_png)

    # multi-page PDF로 합치기 (WebP 한 장 = PDF 한 페이지)
    pdf_path   = os.path.join(output_dir, f"{base_name}-{vp_name}.pdf")
    pdf_images = [Image.open(p).convert("RGB") for p in parts_webp]

    if pdf_images:
        first, rest = pdf_images[0], pdf_images[1:]
        first.save(pdf_path, "PDF", save_all=True, append_images=rest)
        for im in pdf_images:
            im.close()

    kb_pdf = os.path.getsize(pdf_path) // 1024
    log(f"  ✓ {os.path.basename(pdf_path)}  (pages={len(parts_webp)})  {kb_pdf}KB  [PDF]")
    return pdf_path

# ── URL 하나 처리 ─────────────────────────────────────────
async def export_url(url: str, output_dir: str, scroll_time: int,
                     sem: asyncio.Semaphore, browser) -> tuple[int, int]:
    async with sem:
        base_name = sanitize_filename(url)
        log(f"\n[URL] {url}")

        ctx  = await browser.new_context(device_scale_factor=DEVICE_SCALE)
        page = await ctx.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=120000)
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
        except Exception as e:
            log(f"  [ERROR] 페이지 로드 실패: {e}")
            await ctx.close()
            return 0, 3

        await prepare_page(page)

        ok = fail = 0
        for vp_name, vp_conf in VIEWPORT_CONFIGS:
            # 뷰포트 전환 + reflow 안정화
            await page.set_viewport_size({"width": vp_conf["width"], "height": vp_conf["height"]})
            await asyncio.sleep(1)

            # 전환 후 재스크롤: 새 너비에서 lazy-load 재트리거
            await page.evaluate(
                """
                async () => {
                    let lastH = 0, same = 0;
                    while (same < 5) {
                        window.scrollTo(0, document.body.scrollHeight);
                        await new Promise(r => setTimeout(r, 1000));
                        const h = document.body.scrollHeight;
                        if (h === lastH) same++; else same = 0;
                        lastH = h;
                    }
                    // 푸터까지 확실히
                    const footer = document.querySelector('footer, [role="contentinfo"], #footer, .footer');
                    if (footer) {
                        footer.scrollIntoView({ behavior: 'instant', block: 'end' });
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    window.scrollTo(0, document.body.scrollHeight);
                    await new Promise(r => setTimeout(r, 2000));
                    window.scrollTo(0, 0);
                    await new Promise(r => setTimeout(r, 1000));
                }
                """
            )

            # 이미지 decode 재확인
            await page.evaluate(
                """
                () => Promise.all(
                    [...document.querySelectorAll('img')].map(img => {
                        if (!img.complete || img.naturalWidth === 0) {
                            return new Promise(r => {
                                img.onload = img.onerror = r;
                                setTimeout(r, 8000);
                            });
                        }
                        return Promise.resolve();
                    })
                )
                """
            )
            await asyncio.sleep(2)

            try:
                out_path = await capture_viewport(page, vp_name, vp_conf, output_dir, base_name)
                set_finder_tags(out_path, TAGS[vp_name])
                ok += 1
            except Exception as e:
                log(f"  ✗ 실패 ({vp_name}): {e}")
                fail += 1

        await ctx.close()
        return ok, fail

# ── 메인 ──────────────────────────────────────────────────
async def run(base_url: str, output_dir: str, max_pages: int, scroll_time: int):
    os.makedirs(output_dir, exist_ok=True)

    async with async_playwright() as p:
        # 페이지 탐색
        browser_d = await p.chromium.launch(headless=True)
        ctx       = await browser_d.new_context()
        pg        = await ctx.new_page()
        pages     = await discover_pages(pg, base_url, max_pages)
        await ctx.close()
        await browser_d.close()

        log(f"발견된 페이지: {len(pages)}개")
        for i, u in enumerate(pages, 1):
            log(f"  {i}. {u}")
        log(f"\n익스포트 시작 (총 {len(pages) * 3}개, URL {URL_CONCURRENCY}개 동시 × 뷰포트 3개)\n")

        # 캡쳐
        browser = await p.chromium.launch(
            headless=True,
            args=["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
        )
        sem         = asyncio.Semaphore(URL_CONCURRENCY)
        all_results = await asyncio.gather(*[
            export_url(url, output_dir, scroll_time, sem, browser)
            for url in pages
        ])
        await browser.close()

    total_ok   = sum(ok   for ok, _   in all_results)
    total_fail = sum(fail for _, fail in all_results)
    log(f"\n완료!  성공: {total_ok} / 실패: {total_fail}")
    log(f"출력: {os.path.abspath(output_dir)}")

# ── CLI ───────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Website Layout Exporter (WebP/PNG, Option C)")
parser.add_argument("url",                                          help="기준 URL (https://...)")
parser.add_argument("--output",      "-o", default="./exports",    help="출력 디렉터리")
parser.add_argument("--max-pages",   "-m", type=int, default=50,   help="최대 페이지 수")
parser.add_argument("--scroll-time", "-s", type=int, default=60,   help="스크롤 타임아웃(초, 내부 고정값과 별개)")
args = parser.parse_args()

if not urlparse(args.url).scheme:
    print("[ERROR] URL에 https:// 를 포함해주세요")
    sys.exit(1)

asyncio.run(run(args.url, args.output, args.max_pages, args.scroll_time))
