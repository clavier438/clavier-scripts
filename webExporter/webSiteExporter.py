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
    - WebP 스크롤-스티칭: 뷰포트 단위로 내려가며 WebP 캡처 → 세로 스티칭
      (스크롤 트리거 애니메이션·lazy-load가 각 위치에서 올바르게 발동)
    - 뷰포트별 개별 PDF 1개 저장
- URL당 추가 출력: desktop+tablet+mobile 합본 PDF 1개 (-all.pdf, 3페이지)
- URL 3개 동시 처리, 각 URL 안에서 뷰포트 3개 순차 처리
"""

import argparse
import asyncio
import json
import os
import plistlib
import random
import re
import subprocess
import io
import sys
from urllib.parse import urlparse

from PIL import Image
from playwright.async_api import async_playwright

Image.MAX_IMAGE_PIXELS = None  # 대형 이미지 경고 억제

# ── 설정 ──────────────────────────────────────────────────
VIEWPORTS = {
    # scale: 디바이스 pixel ratio. 모두 2x — 디자인 스터디용 충분 + 메모리 절약
    # (이전 mobile 3x → 2x: 페이지당 ~60MB → ~25MB, 956MB OCI 안정성 향상)
    "desktop": {"width": 1440, "height": 900,  "scale": 2},
    "tablet":  {"width": 768,  "height": 1024, "scale": 2},
    "mobile":  {"width": 390,  "height": 844,  "scale": 2},
}
TAGS = {
    "desktop": ["web", "desktop"],
    "tablet":  ["web", "tablet"],
    "mobile":  ["web", "mobile"],
}
_SKIP_VIEWPORTS = {v.strip() for v in os.environ.get("WEBEXP_SKIP_VIEWPORTS", "").split(",") if v.strip()}
VIEWPORT_CONFIGS = [(k, v) for k, v in VIEWPORTS.items() if k not in _SKIP_VIEWPORTS]

# 페이지 로드 재시도 (ERR_CONNECTION_CLOSED, ERR_CONNECTION_REFUSED 등 대비)
# CONNECTION_REFUSED 는 작은 사이트 서버가 동시 요청에 ban 발동한 경우 — backoff 길게
LOAD_RETRY_ATTEMPTS = int(os.environ.get("WEBEXP_LOAD_RETRY", "1"))   # 차단/timeout URL 빠르게 skip
LOAD_TIMEOUT_MS     = int(os.environ.get("WEBEXP_LOAD_TIMEOUT_MS", "30000"))  # default 30s (이전 120s)
LOAD_RETRY_BACKOFF  = [0.0, 5.0, 15.0]  # seconds before each attempt (첫 시도 즉시)
URL_START_JITTER    = float(os.environ.get("WEBEXP_URL_JITTER", "2.0"))  # URL 진입 시 0~N초 랜덤 stagger (rate limit 회피)
VIEWPORT_STAGGER    = float(os.environ.get("WEBEXP_VIEWPORT_STAGGER", "1.0"))  # 같은 URL 의 viewport 사이 sleep (rate limit 회피)

# ── 메모리 워터마크 (OCI 956MB OOM 방어) ──────────────────────
# streaming 패턴: URL 1개 처리 → 즉시 jpeg 디스크 flush + image close → 다음.
# /proc/meminfo MemAvailable 폴링. floor 도달 = browser 재시작 + GC + 회복까지 wait.
# 비-Linux 면 자동 비활성 (floor=0). MEM_FLOOR_MB 직접 지정하면 PCT 무시.
WEBEXP_MEM_FLOOR_MB      = int(os.environ.get("WEBEXP_MEM_FLOOR_MB", "0"))    # 절대 floor (0=auto)
WEBEXP_MEM_FLOOR_PCT     = float(os.environ.get("WEBEXP_MEM_FLOOR_PCT", "20"))  # MemTotal × N%
WEBEXP_PAGES_PER_RESTART = int(os.environ.get("WEBEXP_PAGES_PER_RESTART", "5"))  # N URL 마다 chrome 재기동
WEBEXP_MEM_WAIT_S        = float(os.environ.get("WEBEXP_MEM_WAIT_S", "5"))    # floor 미만 시 polling interval
WEBEXP_MEM_WAIT_MAX_S    = float(os.environ.get("WEBEXP_MEM_WAIT_MAX_S", "60"))  # 회복 대기 max

# locale prefix 매칭: /en/, /it/, /ja-jp/, /pt-br/, /zh-hans/ 등
# 같은 path 의 다국어 변형은 첫 1개만 보존
LOCALE_PREFIX_RE = re.compile(r'^/(?:[a-z]{2}(?:-[a-z]{2,4})?)(/.*)?$', re.IGNORECASE)

# Akamai/Cloudflare/PerimeterX 등 봇 차단 회피용 — 일반 데스크톱 Chrome 으로 가장.
# HeadlessChrome 키워드 + navigator.webdriver=true 가 가장 흔한 차단 시그널.
REALISTIC_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
EXTRA_HEADERS = {
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}
STEALTH_INIT_SCRIPT = """
// 1) navigator.webdriver 완전 제거 (가장 강력한 봇 시그널)
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// 2) Chrome runtime 객체 모방 (정상 Chrome 은 항상 존재)
window.chrome = window.chrome || { runtime: {}, app: {}, csi: () => {}, loadTimes: () => {} };

// 3) navigator.languages 보강 (Headless 는 비어있는 경우 많음)
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

// 4) plugins length 0 회피 (Headless 는 0)
Object.defineProperty(navigator, 'plugins', {
    get: () => [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
    ],
});

// 5) permissions.query: 일부 사이트가 notifications 권한 응답으로 봇 판별
const origQuery = navigator.permissions && navigator.permissions.query;
if (origQuery) {
    navigator.permissions.query = (params) => (
        params && params.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission, onchange: null })
            : origQuery.call(navigator.permissions, params)
    );
}

// 6) WebGL vendor / renderer 가 SwiftShader 면 봇 의심 — Apple GPU 가장
try {
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Apple Inc.';                    // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return 'Apple M1';                       // UNMASKED_RENDERER_WEBGL
        return getParam.call(this, p);
    };
} catch(e) {}

// 7) navigator.platform 보강
Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

// 8) hardwareConcurrency / deviceMemory 정상화
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8 });
"""

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

# ── 메모리 헬퍼 (/proc/meminfo 기반, psutil 의존성 X) ──────
def _read_meminfo() -> dict | None:
    try:
        data: dict[str, int] = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, _, v = line.partition(":")
                data[k] = int(v.strip().split()[0])  # kB
        return data
    except Exception:
        return None

def _compute_mem_floor_kb() -> int:
    info = _read_meminfo()
    if info is None:
        return 0
    if WEBEXP_MEM_FLOOR_MB > 0:
        return WEBEXP_MEM_FLOOR_MB * 1024
    return int(info.get("MemTotal", 0) * WEBEXP_MEM_FLOOR_PCT / 100.0)

_MEM_FLOOR_KB = _compute_mem_floor_kb()
if _MEM_FLOOR_KB > 0:
    _info = _read_meminfo() or {}
    _total_mb = _info.get("MemTotal", 0) // 1024
    log(f"  [mem] floor = {_MEM_FLOOR_KB // 1024}MB (MemTotal {_total_mb}MB × {WEBEXP_MEM_FLOOR_PCT}%) — pages/restart={WEBEXP_PAGES_PER_RESTART}")

def mem_available_kb() -> int:
    info = _read_meminfo()
    if info is None:
        return 10**9  # non-Linux: 임계 체크 사실상 비활성
    return info.get("MemAvailable", info.get("MemFree", 0))

def is_below_floor() -> bool:
    return _MEM_FLOOR_KB > 0 and mem_available_kb() < _MEM_FLOOR_KB

async def wait_for_memory(label: str = "") -> bool:
    """floor 미만이면 GC + sleep polling. 반환=대기 발생 여부."""
    if _MEM_FLOOR_KB == 0 or mem_available_kb() >= _MEM_FLOOR_KB:
        return False
    avail_mb = mem_available_kb() // 1024
    floor_mb = _MEM_FLOOR_KB // 1024
    log(f"  [mem] floor 도달 — avail {avail_mb}MB < {floor_mb}MB ({label}) — GC+wait")
    import gc as _gc
    waited = 0.0
    while mem_available_kb() < _MEM_FLOOR_KB and waited < WEBEXP_MEM_WAIT_MAX_S:
        _gc.collect()
        await asyncio.sleep(WEBEXP_MEM_WAIT_S)
        waited += WEBEXP_MEM_WAIT_S
    log(f"  [mem] resume — avail {mem_available_kb() // 1024}MB after {waited:.0f}s")
    return True

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
    # booking-engine / 인증 페이지 — 디자인 스터디 가치 X + SPA gate 로 stuck.
    # path 부분 일치만 검사 (단순/안전). base_url 로 명시 지정한 경우는 add() 가
    # clean_url 거치지 않으므로 영향 없음.
    SKIP_PATH_PATTERNS = (
        "/reservation", "/booking", "/book/", "/reserve/",
        "/checkout", "/cart",
        "/login", "/sign-in", "/signin",
        "/account", "/my-account", "/signup", "/register",
    )
    # nav 페이지가 인덱스(목록)면 페이지네이션 1~PAGINATION_PAGES까지 수집,
    # 각 인덱스 페이지에서 detail 링크 DETAIL_PER_INDEX 개 추가.
    DETAIL_PER_INDEX  = 3
    PAGINATION_PAGES  = 3

    seen    = set()
    ordered = []

    def clean_url(href: str) -> str | None:
        p = urlparse(href)
        if p.netloc != base_domain:
            return None
        if any(p.path.lower().endswith(e) for e in SKIP_EXT):
            return None
        path_lower = p.path.lower()
        if any(pat in path_lower for pat in SKIP_PATH_PATTERNS):
            return None
        u = f"{p.scheme}://{p.netloc}{p.path}"
        if p.query:
            u += f"?{p.query}"
        return u.rstrip("/")

    def locale_normalized_key(url: str) -> str:
        """locale prefix 제거한 dedupe 키. /it/hotels/x → /hotels/x, /hotels/x → /hotels/x"""
        p = urlparse(url)
        m = LOCALE_PREFIX_RE.match(p.path)
        norm_path = (m.group(1) if m and m.group(1) else (p.path if not m else '/'))
        return f"{p.scheme}://{p.netloc}{norm_path}"

    seen_norm = set()  # locale-normalized URL set — 다국어 변형 dedupe

    def add(url: str) -> bool:
        if not url or url in seen:
            return False
        norm = locale_normalized_key(url)
        if norm in seen_norm:
            return False  # 같은 path 의 다국어 변형 이미 수집됨
        seen.add(url)
        seen_norm.add(norm)
        ordered.append(url)
        return True

    add(base_url.rstrip("/"))

    nav_pages = []
    try:
        await page.goto(base_url, wait_until="domcontentloaded", timeout=60000)
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await auto_scroll(page)

        # nav + header + footer + 일반 navigation 패턴 — Next.js/SPA 처럼 nav 가 hidden 일 때
        # footer 에 카테고리 링크가 있는 패턴(e-commerce 등) 도 함께 잡음
        nav_hrefs = await page.evaluate("""
            () => [...new Set(
                [...document.querySelectorAll(
                    'nav a[href], header a[href], footer a[href], '
                    + '[role="navigation"] a[href], [role="contentinfo"] a[href], '
                    + '[aria-label*="navigation" i] a[href], [aria-label*="menu" i] a[href]'
                )].map(a => a.href)
            )]
        """)
        # nav prefix cap + 절대 max cap (사용자 발견 2026-05-06): aman 같이 path 첫 segment 가
        # 매우 다양한 사이트는 prefix cap 만으론 줄어들지 않음 (30+ unique segment).
        # 절대 max NAV_TOTAL_CAP 를 추가 — nav 의 "처음 N개" 만 (header 우선 순서 가정).
        NAV_PREFIX_CAP = int(os.environ.get("WEBEXP_NAV_PREFIX_CAP", "3"))
        NAV_TOTAL_CAP  = int(os.environ.get("WEBEXP_NAV_TOTAL_CAP", "10"))
        from urllib.parse import urlparse as _up
        prefix_count = {}
        for href in nav_hrefs:
            if len(nav_pages) >= NAV_TOTAL_CAP:
                break
            u = clean_url(href)
            if not u:
                continue
            parts = _up(u).path.strip('/').split('/')
            prefix = parts[0] if parts and parts[0] else ''
            cnt = prefix_count.get(prefix, 0)
            if cnt >= NAV_PREFIX_CAP:
                continue
            if add(u):
                nav_pages.append(u)
                prefix_count[prefix] = cnt + 1
    except Exception as e:
        log(f"  [WARN] base URL 탐색 오류: {e}")

    detail_count = 0
    extra_index_count = 0  # 페이지네이션으로 추가된 인덱스 페이지 수

    DISCOVER_THROTTLE_S = float(os.environ.get("WEBEXP_DISCOVER_THROTTLE_S", "4.0"))
    for nav_url in nav_pages:
        # 같은 nav 그룹에서 처리할 인덱스 페이지 목록.
        # 시작은 nav_url 자체. 첫 진입에서 페이지네이션 감지 시 동적 확장.
        index_pages = [nav_url]
        is_first_visit = True
        for idx_url in index_pages:
            if max_pages and len(ordered) >= max_pages:
                break
            # nav/index 페이지 사이 throttle — rate limit 회피 (사용자 발견 2026-05-05)
            await asyncio.sleep(DISCOVER_THROTTLE_S)
            try:
                await page.goto(idx_url, wait_until="domcontentloaded", timeout=60000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    pass
                await auto_scroll(page)

                # detail(아이템) 링크 수집 — 인덱스든 단일이든 동일 로직
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
                    if count >= DETAIL_PER_INDEX:
                        break
                    u = clean_url(href)
                    if u and add(u):
                        count += 1
                        detail_count += 1

                # 첫 진입에서만 페이지네이션 감지 → 추가 인덱스 페이지 큐잉
                if is_first_visit and len(index_pages) < PAGINATION_PAGES:
                    is_first_visit = False
                    pagination_hrefs = await page.evaluate("""
                        () => {
                            const links = [...document.querySelectorAll('a[href]')];
                            const seen = new Set();
                            const out = [];
                            for (const a of links) {
                                const raw = a.getAttribute('href') || '';
                                if (!raw) continue;
                                // 흔한 페이지네이션 패턴: ?page=N, &page=N, /page/N, ?p=N, paged=N
                                if (!(/[?&](page|paged|p)=\\d+/i.test(raw) || /\\/page\\/\\d+/i.test(raw))) continue;
                                const url = a.href;
                                if (seen.has(url)) continue;
                                seen.add(url);
                                out.push(url);
                            }
                            // 페이지 번호 오름차순 (작은 번호 우선)
                            return out.sort((x, y) => {
                                const mx = x.match(/(?:page=|\\/page\\/|paged=|p=)(\\d+)/i);
                                const my = y.match(/(?:page=|\\/page\\/|paged=|p=)(\\d+)/i);
                                return (mx ? +mx[1] : 999) - (my ? +my[1] : 999);
                            });
                        }
                    """)
                    for href in pagination_hrefs:
                        if len(index_pages) >= PAGINATION_PAGES:
                            break
                        u = clean_url(href)
                        if u and u not in index_pages:
                            index_pages.append(u)
                            if add(u):
                                extra_index_count += 1

            except Exception as e:
                log(f"  [WARN] 인덱스 페이지 탐색 오류 ({idx_url}): {e}")

    if max_pages:
        ordered = ordered[:max_pages]

    log(f"  발견: base(1) + nav({len(nav_pages)}) + 추가인덱스({extra_index_count}) + detail({detail_count}) = {len(ordered)}페이지")
    return ordered

# ── SPA content settle waiter ────────────────────────────
#
# `networkidle` 이후에도 SPA 가 "Please wait..." / "Loading..." 같은 placeholder
# 만 보여주고 form/실제 컨텐츠는 추가 XHR 후 lazy 렌더하는 케이스 (aman reservation 등).
# scrollHeight 가 작고(< 1.5 viewport) main content 가 loader-text 일치하면 추가 대기.
# 폴링: scrollHeight 가 2초 연속 안정 + loader-text 사라짐 → exit. 최대 25s.

LOADER_TEXT_RE = (
    r"^(please\s*wait|loading|loading\.\.\.|loading…|"
    r"잠시만 *기다려|로딩|불러오는)\.*\s*$"
)

async def wait_spa_settled(page, max_wait_s: float = 10.0, stable_s: float = 2.0):
    try:
        await page.evaluate(
            """
            (args) => new Promise(resolve => {
                const { maxWaitMs, stableMs, loaderRe } = args;
                const re = new RegExp(loaderRe, 'i');
                const start = performance.now();
                let lastH = document.body.scrollHeight;
                let stableSince = performance.now();
                let lastLoaderSeen = performance.now();

                const hasLoaderText = () => {
                    // viewport 안 main 영역 텍스트 검사
                    const main = document.querySelector('main, [role="main"], #main, .main, body');
                    if (!main) return false;
                    const text = (main.innerText || '').trim();
                    if (!text) return true;  // 본문 비었음 = 아직 로딩
                    if (text.length < 200 && re.test(text)) return true;
                    // 큰 loader 오버레이 (전체 화면 덮는 텍스트 포함)
                    for (const el of document.querySelectorAll('div, section, [class*="load" i], [class*="wait" i]')) {
                        if (el.offsetWidth < window.innerWidth * 0.4) continue;
                        if (el.offsetHeight < 100) continue;
                        const t = (el.innerText || '').trim();
                        if (t && t.length < 100 && re.test(t)) return true;
                    }
                    return false;
                };

                const tick = () => {
                    const now = performance.now();
                    const elapsed = now - start;
                    const h = document.body.scrollHeight;
                    if (h !== lastH) {
                        lastH = h;
                        stableSince = now;
                    }
                    const loaderActive = hasLoaderText();
                    if (loaderActive) lastLoaderSeen = now;

                    const heightStable = (now - stableSince) >= stableMs;
                    const loaderGone = (now - lastLoaderSeen) >= stableMs;

                    if (heightStable && loaderGone) {
                        resolve({ ok: true, ms: Math.round(elapsed), h });
                        return;
                    }
                    if (elapsed >= maxWaitMs) {
                        resolve({ ok: false, ms: Math.round(elapsed), h, stuckLoader: loaderActive });
                        return;
                    }
                    setTimeout(tick, 400);
                };
                tick();
            })
            """,
            {
                "maxWaitMs": int(max_wait_s * 1000),
                "stableMs": int(stable_s * 1000),
                "loaderRe": LOADER_TEXT_RE,
            },
        )
    except Exception:
        pass

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

    # 7.6) 섹션별 scrollIntoView → scroll 이벤트 발화 → JS-hidden 요소 렌더 트리거
    # (GSAP/ScrollMagic/AOS 등 JS 기반 섹션 visibility를 모두 발동)
    await page.evaluate(
        """
        async () => {
            const sels = [
                'section', 'article', '[class*="section"]', '[class*="block"]',
                '[class*="panel"]', '[class*="row"]', '[data-aos]',
                '[data-scroll]', '[data-gsap]', '[class*="animate"]',
            ];
            const seen = new Set();
            const sections = [];
            for (const sel of sels) {
                for (const el of document.querySelectorAll(sel)) {
                    if (!seen.has(el)) { seen.add(el); sections.push(el); }
                }
            }
            for (const section of sections) {
                section.scrollIntoView({ behavior: 'instant', block: 'center' });
                window.dispatchEvent(new Event('scroll', { bubbles: true }));
                window.dispatchEvent(new Event('wheel',  { bubbles: true }));
                await new Promise(r => setTimeout(r, 80));
            }
            // 마지막으로 맨 위로
            window.scrollTo(0, 0);
            await new Promise(r => setTimeout(r, 500));
        }
        """
    )

    # 8) 이미지 전수 강제 로드 (img 태그 + CSS background-image + picture/srcset)
    await page.evaluate(
        """
        async () => {
            // 8-a) <img>: src 없거나 실패한 것 재시도 + decode
            await Promise.all(
                [...document.querySelectorAll('img')].map(img => {
                    // lazy data-src 계열 강제 주입
                    const ds = img.dataset.src || img.dataset.lazySrc
                             || img.dataset.original || img.dataset.lazy;
                    if (ds && (!img.src || img.src === window.location.href)) img.src = ds;

                    // srcset 있으면 sizes 강제로 뷰포트 너비로 맞춰 최고해상도 선택 유도
                    if (img.srcset && !img.sizes) img.sizes = '100vw';

                    if (!img.src || img.src.startsWith('data:')) return Promise.resolve();
                    if (img.naturalWidth > 0 && img.complete) return img.decode().catch(() => {});

                    return new Promise(resolve => {
                        img.onload = () => img.decode().then(resolve).catch(resolve);
                        img.onerror = resolve;
                        setTimeout(resolve, 15000);
                    });
                })
            );

            // 8-b) CSS background-image: 숨겨진 요소도 강제 표시 → 브라우저가 이미지 로드
            // carousel 슬라이드는 SKIP (opacity unhide 시 슬라이드들 겹쳐 보임)
            const __isCarouselSlide_b = (el) => {
                let cur = el; let depth = 0;
                while (cur && cur !== document.body && depth++ < 8) {
                    const cls = (cur.className && cur.className.toString && cur.className.toString().toLowerCase()) || '';
                    if (/swiper|carousel|slick|slider|splide|flicking|embla|keen-slider|glide/.test(cls)) return true;
                    if (cur.getAttribute && (cur.getAttribute('role') === 'tabpanel' || cur.getAttribute('aria-hidden') === 'true')) return true;
                    cur = cur.parentElement;
                }
                return false;
            };
            document.querySelectorAll('*').forEach(el => {
                try {
                    const bg = getComputedStyle(el).backgroundImage;
                    if (!bg || bg === 'none') return;
                    const s = getComputedStyle(el);
                    const isCarousel = __isCarouselSlide_b(el);
                    // display/visibility 는 lazy bg 로드 위해 잠깐 풀어줘도 안전
                    if (s.display === 'none') el.style.setProperty('display', 'block', 'important');
                    if (s.visibility === 'hidden') el.style.setProperty('visibility', 'visible', 'important');
                    // opacity 만 carousel 인 경우 SKIP (슬라이드 겹침 방지)
                    if (parseFloat(s.opacity) === 0 && !isCarousel) {
                        el.style.setProperty('opacity', '1', 'important');
                    }
                } catch(e) {}
            });

            // 8-c) <picture> source 활성화
            document.querySelectorAll('picture source').forEach(src => {
                if (!src.srcset && src.dataset.srcset) src.srcset = src.dataset.srcset;
            });
        }
        """
    )

    # 8.5) High-res 강제 — srcset 최대 해상도 선택 + scroll-trigger lazy-load + decode 대기
    # 사용자 발견 (2026-05-04): aman nearby 섹션 포커스 이미지가 살짝 흐림.
    # 원인: srcset 에서 `sizes='100vw'` 가 tablet/mobile viewport 에선 중간 크기 선택.
    # 해결: srcset 파싱 후 최대 weight URL 직접 src 에 박고 srcset 제거.
    # + 각 img scrollIntoView (IO 모킹 못 잡는 scroll-position 기반 lazy-load 처리)
    await page.evaluate(
        """
        async () => {
            // 8-d) srcset / data-srcset 에서 최대 해상도 URL 강제 선택
            const pickLargest = (srcset) => {
                if (!srcset) return null;
                const entries = srcset.split(',').map(s => {
                    const parts = s.trim().split(/\\s+/);
                    const url = parts[0];
                    const desc = parts[1] || '1x';
                    let weight = 1;
                    if (desc.endsWith('w')) weight = parseInt(desc) || 1;
                    else if (desc.endsWith('x')) weight = (parseFloat(desc) || 1) * 2000;
                    return { url, weight };
                }).filter(e => e.url);
                if (!entries.length) return null;
                entries.sort((a, b) => b.weight - a.weight);
                return entries[0].url;
            };

            document.querySelectorAll('img').forEach(img => {
                try {
                    // <img srcset>
                    if (img.srcset) {
                        const best = pickLargest(img.srcset);
                        if (best && best !== img.src) img.src = best;
                        // srcset 제거하면 브라우저 가 우리 src 만 사용
                        img.removeAttribute('srcset');
                        img.removeAttribute('sizes');
                    }
                    // data-srcset (lazy lib)
                    if (img.dataset.srcset) {
                        const best = pickLargest(img.dataset.srcset);
                        if (best) img.src = best;
                        delete img.dataset.srcset;
                    }
                    // <picture><source srcset>
                    const picture = img.closest('picture');
                    if (picture) {
                        const sources = picture.querySelectorAll('source[srcset]');
                        let picked = null;
                        for (const s of sources) {
                            const cand = pickLargest(s.srcset);
                            if (cand) { picked = cand; break; }
                        }
                        if (picked && picked !== img.src) img.src = picked;
                    }
                    // LQIP (low-quality image placeholder) — naturalWidth 매우 작으면 swap
                    if (img.naturalWidth > 0 && img.naturalWidth < 200 && img.offsetWidth > 200) {
                        const hires = img.dataset.src || img.dataset.lazySrc
                                    || img.dataset.original || img.dataset.fullsrc;
                        if (hires && hires !== img.src) img.src = hires;
                    }
                } catch(e) {}
            });

            // 8-e) 각 img scrollIntoView — IO 모킹이 안 잡는 scroll-position 기반 lazy-load 트리거
            const visibleImgs = [...document.querySelectorAll('img')].filter(i => i.offsetWidth > 0);
            for (const img of visibleImgs) {
                try {
                    img.scrollIntoView({ block: 'center', behavior: 'instant' });
                    await new Promise(r => setTimeout(r, 25));
                } catch(e) {}
            }
            window.scrollTo(0, 0);

            // 8-f) 모든 img 재디코드 대기 (src 변경 후)
            await Promise.all([...document.querySelectorAll('img')].map(img => {
                if (!img.src || img.src.startsWith('data:')) return Promise.resolve();
                if (img.complete && img.naturalWidth > 0) return img.decode().catch(() => {});
                return new Promise(resolve => {
                    img.onload = () => img.decode().then(resolve).catch(resolve);
                    img.onerror = resolve;
                    setTimeout(resolve, 10000);
                });
            }));
        }
        """
    )

    # 9) 비디오: src 강제 설정 → load() → play() 실행 → 재생 유지 (pause 호출 안 함, loop 강제)
    await page.evaluate(
        """
        async () => {
            const videos = [...document.querySelectorAll('video')];

            // src 주입 + 자동재생 속성 강제
            for (const v of videos) {
                try {
                    const lazySrc = v.dataset.src || v.dataset.lazy
                                  || v.dataset.videoSrc || v.dataset.url;
                    if (lazySrc && !v.currentSrc) v.src = lazySrc;
                    for (const s of v.querySelectorAll('source')) {
                        const dataSrc = s.dataset.src || s.dataset.lazy;
                        if (dataSrc && !s.src) s.src = dataSrc;
                    }
                    v.removeAttribute('data-src');
                    v.muted       = true;
                    v.loop        = true;        // 끝나도 멈추지 않게
                    v.autoplay    = true;
                    v.playsInline = true;
                    v.controls    = false;       // 컨트롤 UI 숨김
                    v.preload     = 'auto';
                } catch(e) {}
            }

            // 로드 대기 → play() 실행 → 재생 유지
            await Promise.all(
                videos.map(v => new Promise(resolve => {
                    const startPlay = () => {
                        v.muted = true;
                        v.play().then(resolve).catch(() => {
                            try { v.currentTime = 0.5; } catch(e) {}
                            resolve();
                        });
                    };
                    if (v.readyState >= 2) { startPlay(); return; }
                    v.addEventListener('canplay',    startPlay, { once: true });
                    v.addEventListener('loadeddata', startPlay, { once: true });
                    v.addEventListener('error',      resolve,   { once: true });
                    try { v.load(); } catch(e) {}
                    setTimeout(resolve, 12000);
                }))
            );
        }
        """
    )

    # 9.5) 비디오 강제 재생 도달 + 더 적극적 retry — 사용자 기준: "동영상 전부 플레이중"
    #      readyState >= 3 + currentTime 진전 + !paused.
    #      재시도 전략: mute toggle, currentTime jump, replay
    timeout_ms = int(12000)
    await page.evaluate(
        """
        async (timeoutMs) => {
            const videos = [...document.querySelectorAll('video')];
            await Promise.all(videos.map(v => new Promise(resolve => {
                const start = Date.now();
                const initialT = v.currentTime;
                let strategyIdx = 0;
                const strategies = [
                    () => { try { v.muted = true; v.play().catch(()=>{}); } catch(e){} },
                    () => { try { v.muted = false; v.muted = true; v.play().catch(()=>{}); } catch(e){} },
                    () => { try { v.currentTime = 0.5; v.play().catch(()=>{}); } catch(e){} },
                    () => { try { v.load(); v.muted = true; v.play().catch(()=>{}); } catch(e){} },
                    () => { try { v.currentTime = 1.0; v.muted = true; v.play().catch(()=>{}); } catch(e){} },
                ];
                const tick = () => {
                    const ready     = v.readyState >= 3;
                    const advancing = v.currentTime > initialT + 0.05;
                    if (ready && advancing && !v.paused) { resolve(); return; }
                    if (Date.now() - start > timeoutMs)  { resolve(); return; }
                    // 1초마다 재시도 전략 변경
                    const elapsed = Date.now() - start;
                    const desiredIdx = Math.min(Math.floor(elapsed / 1500), strategies.length - 1);
                    if (desiredIdx > strategyIdx) {
                        strategyIdx = desiredIdx;
                        strategies[strategyIdx]();
                    } else if (v.paused) {
                        strategies[strategyIdx]();
                    }
                    setTimeout(tick, 200);
                };
                tick();
            })));
        }
        """,
        timeout_ms,
    )
    # 9.6) 추가 안정화 버퍼 — 비디오 player UI 의 spinner fade-out 대기
    await asyncio.sleep(1.5)

    # 9.6.5) Video → static overlay img — frame 콜라주 완전 차단
    # 사용자 발견 (step 9): currentTime + pause 만으론 콜라주 잔존 (video player paused state UI
    # 또는 stitch 시 drawingBuffer 변경 가능성). canvas.drawImage 로 현재 frame 을 jpeg 로
    # 캡처 → video 위에 absolute overlay img 덮기 → stitch 어떤 frame 변화에도 overlay 가 가림.
    await page.evaluate(
        """
        () => {
            document.querySelectorAll('video').forEach(v => {
                try {
                    const rect = v.getBoundingClientRect();
                    if (rect.width < 10 || rect.height < 10) return;
                    if (v.readyState < 2) return;  // HAVE_CURRENT_DATA 미만이면 skip
                    const parent = v.parentElement;
                    if (!parent) return;
                    if (parent.querySelector('img[data-video-overlay]')) return;  // 이미 처리됨

                    const canvas = document.createElement('canvas');
                    canvas.width  = v.videoWidth  || Math.round(rect.width);
                    canvas.height = v.videoHeight || Math.round(rect.height);
                    const ctx = canvas.getContext('2d');
                    let dataUrl = null;
                    try {
                        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                        dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    } catch(e) {
                        // SecurityError (cross-origin tainted) — fallback: 그냥 pause
                        v.pause();
                        return;
                    }

                    const overlay = document.createElement('img');
                    overlay.src = dataUrl;
                    overlay.setAttribute('data-video-overlay', 'true');
                    const cs = getComputedStyle(v);
                    overlay.style.cssText = (
                        'position:absolute!important;' +
                        'left:0!important;top:0!important;' +
                        'width:100%!important;height:100%!important;' +
                        'object-fit:' + (cs.objectFit || 'cover') + '!important;' +
                        'object-position:' + (cs.objectPosition || 'center') + '!important;' +
                        'z-index:99999!important;' +
                        'pointer-events:none!important;'
                    );
                    if (getComputedStyle(parent).position === 'static') {
                        parent.style.position = 'relative';
                    }
                    parent.appendChild(overlay);
                    v.pause();  // 백업 — overlay 가 어떤 이유로 fail 시
                } catch(e) {}
            });
        }
        """
    )

    # 9.7) Carousel active state 보존 — Slick / Drupal slider-cards / 일반 carousel
    # 사용자 발견 2026-05-05:
    #   1) aman 의 carousel 들이 모두 디엑티브로 캡처 → SSR + init 안 됨 → .slick-active 누락
    #   2) Slick lib init 강제 호출 (default option) 시 사이트 SSR 의 .slick-next 가 visible 화
    #      → "Next" 박스 노출 부작용. 해결: arrows:false + dots:false 옵션으로 init.
    #   3) slick 외 'slider-cards' (Drupal paragraph--type--slider-cards) 도 active 필요
    await page.evaluate(
        """
        () => {
            // 1) Slick lib init — step 5 와 정확히 동일 (그때 콜라주 없었음)
            //    추가 호출 (slickGoTo/slickPause/transform freeze) 시 layout 망가지는 경우 발생 →
            //    site 자체 init 결과 신뢰 + 추가 조작 X.
            //    부작용 (Next 박스) 은 stitch loop 의 1.2s wait 동안 user-equivalent state 가 됨.
            try {
                const $ = window.jQuery;
                if ($ && $.fn && $.fn.slick) {
                    document.querySelectorAll('.slick:not(.slick-initialized):not(.unslick), .slick-slider:not(.slick-initialized)').forEach(el => {
                        try { $(el).slick(); } catch(e) {}
                    });
                }
            } catch(e) {}

            // 1-b) Slick lib inject 한 default Next/Prev 버튼만 hide (layout 영향 X)
            document.querySelectorAll('.slick-prev, .slick-next, button.slick-arrow').forEach(el => {
                try {
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('visibility', 'hidden', 'important');
                } catch(e) {}
            });

            // 1-c) Hero gallery (centered carousel) — 첫 슬라이드만 visible 강제
            //    사용자 발견 (step 13b): Slick init 후에도 매 capture 마다 다른 active slide →
            //    fade transition 중간 stage 또는 random startSlide 로 콜라주.
            //    centered carousel (centerMode + slider-3up--centered) 만 타겟 — 첫 슬라이드 외 opacity:0
            //    nearby resorts (slider3up-right, 3 visible) 등 multi-visible 은 영향 X.
            document.querySelectorAll('.slider-3up--centered, .slick--optionset--slider3up-centred').forEach(root => {
                try {
                    const slides = root.querySelectorAll('.slick-slide, .slick__slide');
                    slides.forEach((s, i) => {
                        if (i === 0) {
                            s.style.setProperty('opacity', '1', 'important');
                            s.style.setProperty('visibility', 'visible', 'important');
                        } else {
                            s.style.setProperty('opacity', '0', 'important');
                        }
                    });
                } catch(e) {}
            });

            // 2) Slick fallback class — init 안 됐어도 active 부여
            document.querySelectorAll('.slick, .slick-slider, [class*="slick"]').forEach(root => {
                try {
                    if (root.querySelector('.slick-active')) return;
                    const slides = root.querySelectorAll(':scope > .slick__slide, :scope .slick__slide, :scope > .slick-slide, :scope .slick-track > .slick-slide');
                    if (slides.length === 0) return;
                    const cls = (root.className && root.className.toString && root.className.toString().toLowerCase()) || '';
                    const isCentred = cls.includes('centred') || cls.includes('centered');
                    const visibleCount = Math.min(slides.length, 3);
                    const midIdx = isCentred ? Math.floor(visibleCount / 2) : 0;
                    for (let i = 0; i < visibleCount; i++) {
                        slides[i].classList.add('slick-active');
                        if (i === midIdx) slides[i].classList.add('slick-center', 'slick-current');
                    }
                    const dots = root.querySelectorAll('.slick-dots > li');
                    if (dots.length > 0 && !root.querySelector('.slick-dots > li.slick-active')) {
                        dots[0].classList.add('slick-active');
                    }
                } catch(e) {}
            });

            // 3) Drupal slider-cards 패턴 — 가운데 카드에 흔한 active class 모두 부여
            //    (어떤 클래스명을 사이트 CSS 가 보든 매칭되도록 다중 부여)
            document.querySelectorAll('[class*="slider-cards"]').forEach(root => {
                try {
                    const cards = root.querySelectorAll('[class*="slider-card--"]');
                    if (cards.length === 0) return;
                    if (root.querySelector('.is-active, .is-current, .is-selected, .active, .current')) return;
                    const midIdx = Math.floor(cards.length / 2);
                    const tag = cards[midIdx];
                    if (tag) {
                        ['is-active', 'is-current', 'is-selected', 'active', 'current'].forEach(c => tag.classList.add(c));
                    }
                } catch(e) {}
            });

            // 4) 일반 carousel (swiper / splide / glide / embla) — 첫 슬라이드 active
            const generalCarouselSel = [
                ['.swiper-slide:not(.swiper-slide-active)', 'swiper-slide-active'],
                ['.splide__slide:not(.is-active)', 'is-active'],
                ['.glide__slide:not(.glide__slide--active)', 'glide__slide--active'],
                ['.embla__slide:not(.is-selected)', 'is-selected'],
            ];
            for (const [sel, activeCls] of generalCarouselSel) {
                document.querySelectorAll(sel).forEach(el => {
                    const parent = el.parentElement;
                    if (!parent) return;
                    const sib = [...parent.children].filter(c => c.matches(sel.split(':')[0]));
                    if (sib[0] === el && !parent.querySelector('.' + activeCls)) {
                        el.classList.add(activeCls);
                    }
                });
            }
        }
        """
    )

    # 9.8) Layout stable polling — viewport 진입 / 반응형 transition 후 layout 안정 대기
    # 사용자 발견 (2026-05-05): 반응형 layout 이 의도적으로 천천히 transition 하는 사이트
    # → main 영역 rect + scrollHeight 가 600ms 동안 안정될 때까지 대기 (max 6s)
    await page.evaluate(
        """
        async () => {
            const measure = () => {
                const main = document.querySelector('main, [role="main"]') || document.body;
                const r = main.getBoundingClientRect();
                return [
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight,
                    Math.round(r.width),
                    Math.round(r.height),
                ].join('|');
            };
            let prev = measure();
            let stableCount = 0;
            const start = Date.now();
            while (Date.now() - start < 6000 && stableCount < 2) {
                await new Promise(r => setTimeout(r, 300));
                const cur = measure();
                if (cur === prev) stableCount++;
                else stableCount = 0;
                prev = cur;
            }
        }
        """
    )

    # 9.9) Image lazy-load polling — visible img 전부 loaded 될 때까지 (max 8s)
    # 사용자 발견 (mukayu /rooms tablet): 일부 이미지가 캡처 시점 미로드 (visible_images_loaded fail)
    # 누락 img 에 dataset.src / lazy 속성 강제 적용 + scrollIntoView 로 IO trigger
    await page.evaluate(
        """
        async () => {
            const start = Date.now();
            const maxWait = 8000;
            while (Date.now() - start < maxWait) {
                const imgs = [...document.querySelectorAll('img')];
                const visible = imgs.filter(img => img.offsetWidth >= 50 && img.offsetHeight >= 50);
                const unloaded = visible.filter(img => !(img.complete && img.naturalWidth > 0));
                if (unloaded.length === 0) break;
                unloaded.forEach(img => {
                    try {
                        const lazy = img.dataset.src || img.dataset.lazySrc
                                  || img.dataset.original || img.getAttribute('data-lazy-src');
                        if (lazy && (img.src === '' || img.src.includes('data:') || !img.complete)) {
                            img.src = lazy;
                        }
                        img.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
                    } catch(e) {}
                });
                await new Promise(r => setTimeout(r, 400));
            }
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

# ── Live metrics 수집 (validator 가 사용) ────────────────────
#
# 캡처 직전 페이지 상태 스냅샷. 비디오 플레이중인지, 블로커 있는지, 이미지 로드 됐는지 등.

# ── 캡쳐 로직 ────────────────────────────────────────────

async def capture_viewport(page, vp_name: str, vp_conf: dict) -> Image.Image:
    """
    PNG 스크롤-스티칭 → 단일 PIL Image 반환 (저장은 export_url에서 담당).
    - fixed→absolute: 네비바가 맨 위에 한 번만 등장
    - overflow-x hidden: 오른쪽 흰 여백 제거
    - 뷰포트 단위로 내려가며 캡처 → 스크롤-트리거 발동 보장
    - scale = vp_conf["scale"] (mobile 3x, desktop/tablet 2x)
    """
    width     = vp_conf["width"]
    vp_height = vp_conf["height"]
    scale     = vp_conf["scale"]

    # ── 1) fixed→absolute: 네비바 중복 방지 ──────────────────
    await page.evaluate(
        """
        () => {
            document.querySelectorAll('*').forEach(el => {
                try {
                    const pos = getComputedStyle(el).position;
                    if (pos === 'fixed')  el.style.setProperty('position', 'absolute', 'important');
                    // static: 초기 문서 흐름 위치에 완전 고정 → JS scroll 상태 무관하게 항상 초기 레이아웃
                    if (pos === 'sticky') el.style.setProperty('position', 'static', 'important');
                } catch(e) {}
            });
        }
        """
    )

    # ── 1-b) Scroll-jacking 중화 ──────────────────────────────────────────────
    # 모든 profile 공통: lib destroy + body overflow override (스크롤 측정 위해 필수).
    # 단 `html { height: auto }` 는 SKIP — aesop tablet 등 hero `height: 100%` 가
    # 0 으로 collapse 하는 사례 발견 (2026-05-04 conservative 시도 → desktop=900 fail).
    # height 안 건드려도 body overflow auto 만으로 scrollHeight 측정 가능.
    await page.evaluate(
        """
        () => {
            // ── A) Lib destroy (감지될 때만 — side-effect 없음)
            try {
                if (window.lenis) { window.lenis.destroy?.(); window.lenis.stop?.(); window.lenis = null; }
                if (window.Lenis) window.Lenis = null;
                document.documentElement.classList.remove('lenis', 'lenis-smooth', 'lenis-scrolling');
                document.querySelectorAll('[data-lenis-prevent]').forEach(el => el.removeAttribute('data-lenis-prevent'));
            } catch(e) {}
            try {
                window.locomotive?.destroy?.();
                window.locomotiveScroll?.destroy?.();
            } catch(e) {}
            try {
                if (window.ScrollTrigger) {
                    ScrollTrigger.getAll?.().forEach(t => {
                        try {
                            t.progress?.(1, true);
                            t.disable?.(false);
                            t.kill?.(true);
                        } catch(e) {}
                    });
                    ScrollTrigger.killAll?.();
                    ScrollTrigger.normalizeScroll?.(false);
                }
                window.gsap?.killTweensOf?.('*');
                window.gsap?.globalTimeline?.progress?.(1);
            } catch(e) {}
            try {
                window.fullpage_api?.destroy?.('all');
                window.fullpage?.destroy?.('all');
            } catch(e) {}
            try {
                if (window.Scrollbar?.destroyAll) window.Scrollbar.destroyAll();
            } catch(e) {}

            // ── B) Locomotive 컨테이너 정리
            document.querySelectorAll('[data-scroll-container]').forEach(el => {
                el.removeAttribute('data-scroll-container');
                el.style.setProperty('transform', 'none', 'important');
                el.style.setProperty('position', 'static', 'important');
            });

            // ── C) Snap-scroll + body overflow override
            // body overflow hidden 사이트 (aesop) 는 스크롤 측정 위해 풀어줘야 함.
            // 단 html { height: auto } 는 hero 100% collapse 유발 → SKIP.
            const root = document.documentElement;
            const body = document.body;
            root.style.setProperty('scroll-snap-type', 'none', 'important');
            body.style.setProperty('scroll-snap-type', 'none', 'important');
            root.style.setProperty('scroll-behavior', 'auto', 'important');
            body.style.setProperty('scroll-behavior', 'auto', 'important');
            root.style.setProperty('overflow', 'auto', 'important');
            body.style.setProperty('overflow', 'auto', 'important');
            // html height=auto 는 scroll 동작 위해 필수 (aesop 같은 사이트는 안 하면 scroll-jack 풀림 안 됨)
            // 부작용: hero `height: 100%` 가 0 으로 collapse 가능. body min-height 로 보강.
            root.style.setProperty('height', 'auto', 'important');
            body.style.setProperty('min-height', '100vh', 'important');

            // ── D) 모든 element snap 정리 + 큰 fixed → absolute
            document.querySelectorAll('*').forEach(el => {
                try {
                    const s = getComputedStyle(el);
                    if (s.scrollSnapType && s.scrollSnapType !== 'none') {
                        el.style.setProperty('scroll-snap-type', 'none', 'important');
                    }
                    if (s.scrollSnapAlign && s.scrollSnapAlign !== 'none') {
                        el.style.setProperty('scroll-snap-align', 'none', 'important');
                    }
                    if (el !== document.body && el !== document.documentElement) {
                        if (s.position === 'fixed' && (el.offsetWidth > window.innerWidth * 0.5 || el.offsetHeight > window.innerHeight * 0.5)) {
                            el.style.setProperty('position', 'absolute', 'important');
                        }
                    }
                } catch(e) {}
            });

            // ── E) scroll reset
            try {
                window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                document.scrollingElement.scrollTop = 0;
            } catch(e) {}

            // 9) requestAnimationFrame loop 가 스크롤 위치를 강제로 0 으로 되돌리는 케이스
            //    → 우리가 scrollTo 후 즉시 캡처하면 잡힘. 추가 처리 불필요.
        }
        """
    )
    # Reflow 대기 — 위 변경이 layout 에 반영되도록
    await asyncio.sleep(0.8)

    # ── 2) overflow-x hidden: 오른쪽 흰 박스 제거 ────────────
    await page.evaluate(
        """
        () => {
            document.documentElement.style.setProperty('overflow-x', 'hidden', 'important');
            document.body.style.setProperty('overflow-x', 'hidden', 'important');
        }
        """
    )

    # css_total 안정화: scrollHeight 가 0 인 경우(Akamai 차단 후 빈 페이지 등)
    # 짧게 폴링하며 회복 시도 (max 3초). 끝까지 0 이면 RuntimeError 로 상위 retry 유도.
    css_total = 0
    for _ in range(15):
        css_total = await page.evaluate(
            "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, "
            "window.innerHeight)"
        )
        if css_total > vp_height // 2:
            break
        await asyncio.sleep(0.2)
    # 페이지 height 상한 — terms/privacy 같은 endless 페이지 방어 (default 10000px)
    # WEBEXP_MAX_HEIGHT=0 면 무제한 (이전 동작 보존)
    max_h = int(os.environ.get("WEBEXP_MAX_HEIGHT", "10000"))
    if max_h > 0 and css_total > max_h:
        log(f"  [{vp_name}] css_height={css_total}px → cap {max_h}px (WEBEXP_MAX_HEIGHT)")
        css_total = max_h
    else:
        log(f"  [{vp_name}] css_height={css_total}px")
    if css_total <= 1:
        raise RuntimeError(f"css_height=0 (likely empty/blocked page)")

    # ── 3) PNG 캡처 → PIL WebP 변환 스크롤-스티칭 ────────────
    # Playwright는 png/jpeg만 지원 → PNG(무손실)로 캡처 후 PIL에서 WebP lossless 변환
    # animations="disabled" per capture: 트랜지션 완료 상태로 fast-forward
    chunks: list[Image.Image] = []
    covered = 0

    while covered < css_total:
        actual_y = min(covered, max(0, css_total - vp_height))
        # 매 stitch iter 마다 fixed → absolute 재적용 (사용자 발견 2026-05-05):
        # site JS 가 scroll trigger 로 nav 를 fixed 로 다시 바꿔서 매 viewport 에 nav 가 찍힘.
        # 또한 cursor 를 viewport 밖으로 이동 → mouseenter/hover trigger 차단.
        await page.evaluate(f"""
            document.querySelectorAll('*').forEach(el => {{
                try {{
                    const pos = getComputedStyle(el).position;
                    if (pos === 'fixed')  el.style.setProperty('position', 'absolute', 'important');
                    if (pos === 'sticky') el.style.setProperty('position', 'static', 'important');
                }} catch(e) {{}}
            }});
            window.scrollTo(0, {actual_y});
            window.dispatchEvent(new Event('scroll', {{bubbles: true}}));
            window.dispatchEvent(new Event('wheel',  {{bubbles: true}}));
        """)
        try:
            await page.mouse.move(9999, 9999)  # cursor 화면 밖 — hover state 차단
        except Exception:
            pass
        # JS 애니메이션 완료 대기 + 비디오 재개 (animations="disabled" 사용 안 함 —
        # 초기 상태 opacity:0 요소가 얼어버리는 문제 방지)
        await asyncio.sleep(1.2)
        await page.evaluate("""
            async () => {
                // Video FREEZE — _frozenAt 으로 reset + pause (콜라주 방지)
                // prepare_page 9.6.5 에서 _frozenAt 저장됨. 매 stitch iter 마다 같은 frame.
                for (const v of document.querySelectorAll('video')) {
                    try {
                        v.muted = true;
                        if (typeof v._frozenAt === 'number') {
                            v.currentTime = v._frozenAt;
                        }
                        v.pause();
                    } catch(e) {}
                }
                // readyState >= 3 (HAVE_FUTURE_DATA) 만 확인 (frame 변경 X)
                const videos = [...document.querySelectorAll('video')];
                if (videos.length > 0) {
                    const start = Date.now();
                    while (Date.now() - start < 1500) {
                        if (videos.every(v => v.readyState >= 3)) break;
                        await new Promise(r => setTimeout(r, 150));
                    }
                }
                // opacity:0 강제 표시 — 단 carousel/slider/tab 슬라이드는 SKIP
                // (캐러셀의 비활성 슬라이드를 unhide 하면 텍스트가 겹쳐 보임 — aesop 사례)
                const __isCarouselSlide = (el) => {
                    let cur = el;
                    let depth = 0;
                    while (cur && cur !== document.body && depth++ < 8) {
                        const cls = (cur.className && cur.className.toString && cur.className.toString().toLowerCase()) || '';
                        if (/swiper|carousel|slick|slider|splide|flicking|embla|keen-slider|glide/.test(cls)) return true;
                        const role = cur.getAttribute && cur.getAttribute('role');
                        if (role === 'tabpanel') return true;
                        // aria-hidden=true 명시적 의도된 숨김 — 존중
                        if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return true;
                        cur = cur.parentElement;
                    }
                    return false;
                };
                document.querySelectorAll('*').forEach(el => {
                    try {
                        const s = getComputedStyle(el);
                        if (parseFloat(s.opacity) < 0.05 && s.display !== 'none') {
                            if (__isCarouselSlide(el)) return;  // 캐러셀 슬라이드는 그대로
                            el.style.setProperty('opacity', '1', 'important');
                            el.style.setProperty('visibility', 'visible', 'important');
                            el.style.setProperty('transform', 'none', 'important');
                        }
                    } catch(e) {}
                });
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            }
        """)
        await asyncio.sleep(0.5)  # rAF 이후 페인트 완료 버퍼

        # JPEG 으로 캡쳐: 어차피 PDF 안에서 JPEG 으로 압축됨 + 메모리/timeout 절약
        # quality=92 = 시각적으로 lossless 에 가까움 (디자인 스터디용)
        img_bytes = await page.screenshot(full_page=False, type="jpeg", quality=92)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

        crop_top_css = covered - actual_y
        new_css_h    = min(vp_height - crop_top_css, css_total - covered)
        crop_top_px  = int(crop_top_css * scale)
        new_px_h     = int(new_css_h   * scale)

        chunks.append(img.crop((0, crop_top_px, img.width, crop_top_px + new_px_h)))
        img.close()
        covered += new_css_h

    # ── 4) 스티칭 → Image 반환 (저장은 export_url에서) ──────────
    total_h  = sum(c.height for c in chunks)
    canvas_w = chunks[0].width if chunks else int(width * scale)

    canvas = Image.new("RGB", (canvas_w, total_h))
    y_off = 0
    for c in chunks:
        canvas.paste(c, (0, y_off))
        y_off += c.height
        c.close()

    log(f"  ✓ [{vp_name}]  {width}×{css_total}px  →  {canvas.width}×{canvas.height}px (@{scale}x)")
    return canvas

# ── URL 하나 처리 ─────────────────────────────────────────
async def export_url(url: str, output_dir: str, scroll_time: int,
                     sem: asyncio.Semaphore, browser) -> tuple[int, int]:
    """
    뷰포트마다 새 컨텍스트 + 새 페이지 로드.
    - 각 뷰포트 치수로 처음부터 로드 → IO가 올바른 치수 기준으로 자연스럽게 발동
    - IO 모킹 없음 → prepare_page 스크롤이 IO를 자연 트리거
    - 스크롤 기반 배경색도 각 캡쳐 위치에서 올바르게 반영
    - 모든 뷰포트 완료 후 합본 PDF 저장 (desktop→tablet→mobile, 각 페이지)
    """
    async with sem:
        base_name = sanitize_filename(url)
        log(f"\n[URL] {url}")

        # 동시 connect 폭주 분산 (다른 URL/viewport 와 시작 시점 분리)
        if URL_START_JITTER > 0:
            await asyncio.sleep(random.random() * URL_START_JITTER)

        ok = fail = 0
        # streaming 모드: image 객체 누적 X, frame_path 메타데이터만 보관.
        # PDF 합치기는 run() 마지막에 lazy Image.open() 으로 1장씩.
        captured: list[dict] = []  # {vp_name, frame_path, metrics, width, height}

        for vp_idx, (vp_name, vp_conf) in enumerate(VIEWPORT_CONFIGS):
            # 같은 URL 의 viewport 사이 stagger — 같은 도메인 spike 분산
            if vp_idx > 0 and VIEWPORT_STAGGER > 0:
                await asyncio.sleep(VIEWPORT_STAGGER)

            log(f"  [{vp_name}] 로드 중...")

            # 페이지 로드 — ERR_CONNECTION_CLOSED 등 일시 네트워크 오류 대비 retry
            # 컨텍스트는 시도마다 새로 생성 (이전 시도의 부분 상태 폐기)
            ctx = page = None
            load_ok  = False
            last_err = None

            for attempt in range(LOAD_RETRY_ATTEMPTS):
                if attempt > 0:
                    log(f"  [{vp_name}] 재시도 {attempt}/{LOAD_RETRY_ATTEMPTS - 1} ({type(last_err).__name__}: {last_err})")
                await asyncio.sleep(LOAD_RETRY_BACKOFF[min(attempt, len(LOAD_RETRY_BACKOFF) - 1)])

                # 새 컨텍스트 — chrome 이 죽으면 무한 대기 가능 → wait_for 30s
                if ctx is not None:
                    try: await asyncio.wait_for(ctx.close(), timeout=10)
                    except Exception: pass
                ctx = await asyncio.wait_for(browser.new_context(
                    device_scale_factor=vp_conf["scale"],
                    viewport={"width": vp_conf["width"], "height": vp_conf["height"]},
                    user_agent=REALISTIC_UA,
                    extra_http_headers=EXTRA_HEADERS,
                    locale="en-US",
                ), timeout=30)
                # 스텔스 스크립트 (모든 페이지 진입 직전에 navigator.* 마스킹)
                await ctx.add_init_script(STEALTH_INIT_SCRIPT)
                page = await ctx.new_page()

                # IO 모킹: 페이지 로드 전 주입 (올바른 뷰포트 치수 기준으로 발동)
                # → 이미지 컨테이너가 visible 상태가 되어 브라우저가 이미지를 실제로 로드함
                # prepare_page가 끝에서 scrollTo(0,0)하므로 스크롤 기반 배경색은 거기서 리셋됨
                await page.add_init_script("""
                    window.IntersectionObserver = class IntersectionObserver {
                        constructor(callback) { this._cb = callback; }
                        observe(target) {
                            this._cb([{
                                target,
                                isIntersecting: true,
                                intersectionRatio: 1,
                                boundingClientRect: target.getBoundingClientRect(),
                                intersectionRect: target.getBoundingClientRect(),
                                rootBounds: null,
                                time: performance.now()
                            }], this);
                        }
                        unobserve() {}
                        disconnect() {}
                        takeRecords() { return []; }
                    };
                """)

                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=LOAD_TIMEOUT_MS)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=5000)
                    except Exception:
                        pass
                    # SPA loader-text 가 사라질 때까지 추가 대기 (aman reservation 등)
                    await wait_spa_settled(page)
                    load_ok = True
                    break
                except Exception as e:
                    last_err = e

            if not load_ok:
                log(f"  [ERROR] 페이지 로드 실패 ({vp_name}, {LOAD_RETRY_ATTEMPTS}회 시도): {last_err}")
                if ctx is not None:
                    try: await ctx.close()
                    except Exception: pass
                fail += 1
                continue

            # prepare_page의 전체 스크롤이 IO를 자연스럽게 발동시킴
            # → 요소들이 visible 상태로 전환, 이후 캡쳐 시 유지
            # hard timeout 60s — chrome promise 가 영원히 resolve 안 되는 페이지 (work.co/grid 등) 방어
            try:
                await asyncio.wait_for(prepare_page(page), timeout=60)
            except asyncio.TimeoutError:
                log(f"  [WARN] prepare_page timeout 60s ({vp_name}) — skip")
                try: await ctx.close()
                except Exception: pass
                fail += 1
                continue
            except Exception as e:
                log(f"  [WARN] prepare_page 오류 ({vp_name}): {type(e).__name__} — skip")
                try: await ctx.close()
                except Exception: pass
                fail += 1
                continue

            try:
                # capture_viewport 도 hard 120s — 큰 페이지 stitching 충분
                img = await asyncio.wait_for(capture_viewport(page, vp_name, vp_conf), timeout=120)
                w, h = img.width, img.height
                # 빈 이미지(0px) 는 PDF 빌드 불가능
                if w <= 0 or h <= 0:
                    log(f"  [WARN] 빈 이미지 skip ({vp_name})")
                    img.close()
                    fail += 1
                else:
                    frame_dir = os.path.join(output_dir, "frames")
                    os.makedirs(frame_dir, exist_ok=True)
                    url_slug = sanitize_filename(url)
                    frame_path = os.path.join(frame_dir, f"{url_slug}__{vp_name}.jpg")
                    try:
                        img.save(frame_path, "JPEG", quality=85, optimize=True)
                        img.close()  # 즉시 메모리 해제 — 누적 X
                        captured.append({
                            "vp_name": vp_name,
                            "frame_path": frame_path,
                            "width": w,
                            "height": h,
                        })
                        ok += 1
                    except Exception as e:
                        log(f"  [WARN] frame 저장 실패 ({vp_name}): {e}")
                        try: img.close()
                        except Exception: pass
                        fail += 1
            except Exception as e:
                log(f"  ✗ 실패 ({vp_name}): {e}")
                fail += 1

            await ctx.close()

        if captured:
            labels = "+".join(e["vp_name"] for e in captured)
            log(f"  ✓ {base_name}  [{labels}]  ({len(captured)} viewports)")

        return ok, fail, captured

# ── 메인 ──────────────────────────────────────────────────
async def run(base_url: str, output_dir: str, max_pages: int, scroll_time: int, concurrency: int):
    os.makedirs(output_dir, exist_ok=True)

    # 봇 차단 회피용 launch args — AutomationControlled 비활성화가 핵심.
    # Akamai/Cloudflare 등이 chromium 실행 플래그(--enable-automation 등)로 봇 판별.
    # `--headless=new` = 신규 Chrome 헤드리스 모드 (헤드풀과 동일한 DOM/JS 환경, 봇 시그널 적음).
    # `channel="chromium"` = headless_shell 가 아닌 풀 chromium 바이너리 (Akamai 차단 회피).
    LAUNCH_ARGS = [
        "--autoplay-policy=no-user-gesture-required",
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-site-isolation-trials",
        "--headless=new",
        # 메모리 절약 (956MB OCI 안정성)
        "--memory-pressure-off",
        "--disable-software-rasterizer",
        "--disable-gpu",  # OCI VM 은 GPU 없음 → SwiftShader 메모리 절약
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--js-flags=--max-old-space-size=384",  # V8 heap 384MB 캡
    ]
    LAUNCH_CHANNEL = "chromium"

    async with async_playwright() as p:
        # 페이지 탐색
        browser_d = await p.chromium.launch(
            headless=True, channel=LAUNCH_CHANNEL, args=LAUNCH_ARGS,
        )
        ctx       = await browser_d.new_context(
            user_agent=REALISTIC_UA,
            extra_http_headers=EXTRA_HEADERS,
            locale="en-US",
        )
        await ctx.add_init_script(STEALTH_INIT_SCRIPT)
        pg        = await ctx.new_page()
        pages     = await discover_pages(pg, base_url, max_pages)
        await ctx.close()
        await browser_d.close()

        log(f"발견된 페이지: {len(pages)}개")
        for i, u in enumerate(pages, 1):
            log(f"  {i}. {u}")
        log(f"\n익스포트 시작 (총 {len(pages) * 3}개, URL 1개 sequential × 뷰포트 3개) — streaming 모드\n")

        # 캡쳐 — streaming + watermark
        # concurrency 인자는 무시 (legacy 호환). OOM 방어를 위해 항상 sequential.
        # browser 는 N URL 마다 또는 메모리 floor 도달 시 재시작 (chrome cumulative leak 방어).
        async def _launch_browser():
            return await p.chromium.launch(
                headless=True, channel=LAUNCH_CHANNEL, args=LAUNCH_ARGS,
            )

        browser = await _launch_browser()
        all_results: list[tuple[int, int, list]] = []
        pages_since_restart = 0
        sem_dummy = asyncio.Semaphore(1)  # export_url 시그니처 호환용

        for i, url in enumerate(pages, 1):
            # browser disconnect 감지 또는 메모리/주기 도달 시 재시작
            try:
                browser_alive = browser.is_connected()
            except Exception:
                browser_alive = True  # API 없으면 살아있다고 가정
            need_restart = (
                not browser_alive
                or pages_since_restart >= WEBEXP_PAGES_PER_RESTART
                or is_below_floor()
            )
            if need_restart:
                avail_mb = mem_available_kb() // 1024
                reason = "disconnected" if not browser_alive else f"처리 {pages_since_restart} URL, avail {avail_mb}MB"
                log(f"  [mem] browser 재시작 — {reason}")
                try: await asyncio.wait_for(browser.close(), timeout=10)
                except Exception as e: log(f"  [mem] browser close 실패: {type(e).__name__}")
                await wait_for_memory("post browser-close")
                browser = await _launch_browser()
                pages_since_restart = 0

            log(f"\n[{i}/{len(pages)}]")
            try:
                ok, fail, captured = await export_url(url, output_dir, scroll_time, sem_dummy, browser)
            except Exception as e:
                log(f"  [ERROR] export_url 실패 ({url}): {type(e).__name__} — skip")
                ok, fail, captured = 0, len(VIEWPORT_CONFIGS), []
                # browser 상태 의심 → 다음 URL 시작 시 재시작 트리거
                pages_since_restart = WEBEXP_PAGES_PER_RESTART
            all_results.append((ok, fail, captured))
            pages_since_restart += 1

        try: await browser.close()
        except Exception: pass

    total_ok   = sum(ok   for ok, _, _ in all_results)
    total_fail = sum(fail for _, fail, _ in all_results)

    # ── 사이트 전체 단일 PDF: 페이지 순서 × 뷰포트 순서 (desktop→tablet→mobile) ──
    site_name = sanitize_filename(urlparse(base_url).netloc or "site")
    out_pdf   = os.path.join(output_dir, f"{site_name}.pdf")

    # streaming 모드에서 frame 들은 export_url 안에서 이미 jpeg 로 저장됨.
    # 여기서는 metadata 수집만. PDF 빌드는 아래 streaming build (reportlab) 가 담당.
    frames_index: list[dict] = []
    for url, (_, _, captured) in zip(pages, all_results):
        for entry in captured:
            frame_path = entry["frame_path"]
            try:
                size_bytes = os.path.getsize(frame_path)
            except OSError:
                log(f"  [WARN] frame 파일 누락: {frame_path}")
                continue
            frames_index.append({
                "url": url,
                "viewport": entry["vp_name"],
                "path": frame_path,
                "width": entry["width"],
                "height": entry["height"],
                "size_bytes": size_bytes,
            })

    if frames_index:
        # streaming PDF build — reportlab 이 frame 단위 page write + 즉시 메모리 release.
        # 기존 PIL save_all 은 모든 frame batch 빌드 → 큰 사이트 OOM (OCI 956MB 사례 확인).
        try:
            from reportlab.pdfgen import canvas as _rl_canvas
            from reportlab.lib.utils import ImageReader as _RLImageReader
            c = _rl_canvas.Canvas(out_pdf)
            for entry in frames_index:
                w, h = entry["width"], entry["height"]
                c.setPageSize((w, h))
                # ImageReader(path) — reportlab 이 lazy 로 stream. 페이지마다 1장 메모리 → release.
                c.drawImage(_RLImageReader(entry["path"]), 0, 0,
                            width=w, height=h, preserveAspectRatio=False)
                c.showPage()
            c.save()
            kb = os.path.getsize(out_pdf) // 1024
            log(f"\n✓ 단일 PDF: {os.path.basename(out_pdf)}  ({len(frames_index)} 페이지, {kb}KB) [streaming]")
        except ImportError:
            # fallback: PIL save_all (작은 사이트만 안전, 큰 사이트는 OOM 위험)
            log(f"  [WARN] reportlab 없음 — PIL save_all fallback (큰 사이트는 OOM 가능)")
            imgs = [Image.open(f["path"]) for f in frames_index]
            imgs[0].save(out_pdf, "PDF", save_all=True, append_images=imgs[1:])
            for img in imgs: img.close()
            kb = os.path.getsize(out_pdf) // 1024
            log(f"\n✓ 단일 PDF: {os.path.basename(out_pdf)}  ({len(frames_index)} 페이지, {kb}KB) [PIL]")
        set_finder_tags(out_pdf, ["web", "all"])

    log(f"\n완료!  성공: {total_ok} / 실패: {total_fail}")
    log(f"출력: {os.path.abspath(output_dir)}")

# ── CLI ───────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Website Layout Exporter (WebP/PNG, Option C)")
    parser.add_argument("url",                                          help="기준 URL (https://...)")
    parser.add_argument("--output",      "-o", default="./exports",    help="출력 디렉터리")
    parser.add_argument("--max-pages",   "-m", type=int, default=50,   help="최대 페이지 수")
    parser.add_argument("--scroll-time", "-s", type=int, default=60,   help="스크롤 타임아웃(초, 내부 고정값과 별개)")
    parser.add_argument("--concurrency", "-c", type=int, default=2,    help="URL 동시 처리 수 (작은 사이트 ban 잦으면 1, 큰 사이트는 3)")
    args = parser.parse_args()

    if not urlparse(args.url).scheme:
        print("[ERROR] URL에 https:// 를 포함해주세요")
        sys.exit(1)

    asyncio.run(run(args.url, args.output, args.max_pages, args.scroll_time, args.concurrency))
