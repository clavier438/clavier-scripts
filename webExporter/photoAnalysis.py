#!/usr/bin/env python3
"""
photoAnalysis.py — WebSiteExporter 동반 모듈 (디자인 스터디용)

한 사이트(지정 스코프)의 사진을 전수 수집하고, **각 사진이 어떤 후처리를 거쳤는지**
객관적 지표로 측정한 뒤, 비슷한 후처리/룩끼리 "컨셉"으로 묶어주고,
그 사이트 사진들의 일반적인 후처리 레시피를 정리해준다.

이 모듈은 webSiteExporter.py 와 독립적이다 (모듈식 / 충돌 회피). 두 가지 입력 모드:

  1) 사이트에서 직접 수집 (playwright 필요):
        python photoAnalysis.py --from https://example.com -o ./study
        # 스코프: --same-origin(기본) / --path-prefix /work / --max-pages N

  2) 이미 받아둔 폴더 분석 (webSiteExporter --download-images 결과 등):
        python photoAnalysis.py --dir ./exports/images -o ./study

산출물 (-o 디렉터리):
    report.md          — 사람이 읽는 디자인 스터디 리포트 (컨셉별 + 전체 후처리 레시피)
    analysis.json      — 전체 측정값 (이미지별 / 컨셉별 / 전체)
    palette_overall.png, palette_concept_N.png  — 도미넌트 색 팔레트 스와치
    contact_concept_N.png                        — 컨셉별 대표 사진 컨택트시트
    images/            — (--from 모드에서) 다운로드한 원본 사진

후처리 측정 항목:
    노출 / 전역 대비 / 블랙포인트(블랙 리프트) / 다이내믹 레인지 / 클리핑
    색온도(웜·쿨) / 틴트(그린·마젠타) / 채도 / 비비드니스
    split-tone (셰도우 vs 하이라이트 색 캐스트 — 시네마틱 틸-오렌지 탐지)
    비네팅 / 그레인·노이즈(필름 그레인) / 샤프닝(아쿠턴스) / 로컬 대비(클래리티)
    도미넌트 팔레트

의존성: pillow, numpy  (--from 모드는 playwright 추가)
"""

import argparse
import asyncio
import json
import math
import os
import re
import sys
from urllib.parse import urlparse, urljoin

import numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None  # 대형 배너 허용

# ── 튜닝 상수 ──────────────────────────────────────────────
ANALYZE_MAX_DIM   = 768    # 분석용 다운스케일 한도 (그레인/샤프닝 지표 보존하면서 속도 확보)
PALETTE_COLORS    = 6      # 이미지당 도미넌트 색 개수
MIN_IMAGE_DIM     = 64     # 이보다 작으면 아이콘/스프라이트로 보고 스킵
MIN_FILE_BYTES    = 3000   # 너무 작은 파일(로고/아이콘) 스킵
MAX_CLUSTERS      = 6      # 자동 컨셉 분리 상한
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif")


def log(msg: str):
    print(msg, flush=True)


# ════════════════════════════════════════════════════════════
#  1) 수집  (모드 A: 사이트 직접 / 모드 B: 폴더)
# ════════════════════════════════════════════════════════════

def _safe_name(url: str) -> str:
    p = urlparse(url)
    base = os.path.basename(p.path) or "img"
    base = re.sub(r"[^\w\-.]", "_", base)[:90]
    if not os.path.splitext(base)[1]:
        base += ".img"
    return base


async def crawl_and_download(start_url: str, out_images: str, *, same_origin: bool,
                             path_prefix: str | None, max_pages: int, scroll_time: int) -> list[str]:
    """playwright 로 스코프 내 페이지를 돌며 모든 사진을 다운로드. 저장 경로 리스트 반환.

    webSiteExporter 의 이미지 추출(JS)과 동일한 규칙: img.currentSrc + picture/source[srcset]
    최대 해상도 + CSS background-image. page.request 로 받아 쿠키/UA 유지(봇 차단 회피)."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        log("[ERROR] --from 모드는 playwright 가 필요합니다:  pip install playwright && playwright install chromium")
        sys.exit(1)

    origin = urlparse(start_url)
    os.makedirs(out_images, exist_ok=True)

    EXTRACT_IMGS = r"""() => {
        const urls = new Set();
        const abs = (u) => { try { return new URL(u, location.href).href; } catch(e){ return null; } };
        const pick = (srcset) => {
            if(!srcset) return null;
            const e = srcset.split(',').map(s=>{const p=s.trim().split(/\s+/);return{u:p[0],w:parseInt(p[1])||0};}).filter(x=>x.u);
            if(!e.length) return null;
            e.sort((a,b)=>b.w-a.w); return e[0].u;
        };
        document.querySelectorAll('img').forEach(img=>{
            const s = img.currentSrc || img.src;
            if(s && !s.startsWith('data:')){ const a=abs(s); if(a) urls.add(a); }
            const best = pick(img.srcset) || pick(img.dataset.srcset);
            if(best && !best.startsWith('data:')){ const a=abs(best); if(a) urls.add(a); }
        });
        document.querySelectorAll('source[srcset]').forEach(src=>{
            const best = pick(src.srcset);
            if(best && !best.startsWith('data:')){ const a=abs(best); if(a) urls.add(a); }
        });
        document.querySelectorAll('*').forEach(el=>{
            const bg = getComputedStyle(el).backgroundImage;
            if(bg && bg!=='none'){ const re=/url\((["']?)([^"')]+)\1\)/g; let m;
                while((m=re.exec(bg))!==null){ if(m[2] && !m[2].startsWith('data:')){ const a=abs(m[2]); if(a) urls.add(a);} } }
        });
        return [...urls];
    }"""

    EXTRACT_LINKS = r"""() => [...document.querySelectorAll('a[href]')].map(a=>a.href)"""

    def in_scope(u: str) -> bool:
        pu = urlparse(u)
        if pu.scheme not in ("http", "https"):
            return False
        if same_origin and pu.netloc != origin.netloc:
            return False
        if path_prefix and not pu.path.startswith(path_prefix):
            return False
        return True

    saved: list[str] = []
    seen_img: set[str] = set()
    seen_files: set[str] = set()
    visited: set[str] = set()
    queue: list[str] = [start_url]

    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = await ctx.new_page()

        while queue and (max_pages <= 0 or len(visited) < max_pages):
            url = queue.pop(0)
            key = url.split("#")[0]
            if key in visited:
                continue
            visited.add(key)
            try:
                await page.goto(url, wait_until="networkidle", timeout=45000)
            except Exception as e:
                log(f"  [skip] {url}  ({type(e).__name__})")
                continue

            # 풀스크롤 — lazy-load 트리거
            try:
                await page.evaluate(r"""async (ms) => {
                    const sleep = (m)=>new Promise(r=>setTimeout(r,m));
                    const t0 = Date.now(); let y = 0;
                    while (Date.now()-t0 < ms) {
                        window.scrollBy(0, window.innerHeight*0.9); await sleep(120);
                        if (window.scrollY === y) break; y = window.scrollY;
                    }
                    window.scrollTo(0,0); await sleep(200);
                }""", scroll_time * 1000)
            except Exception:
                pass

            try:
                img_urls = await page.evaluate(EXTRACT_IMGS)
            except Exception:
                img_urls = []

            page_saved = 0
            for iu in img_urls:
                if iu in seen_img:
                    continue
                seen_img.add(iu)
                try:
                    resp = await page.request.get(iu, timeout=20000)
                    if not resp.ok:
                        continue
                    body = await resp.body()
                    if not body or len(body) < MIN_FILE_BYTES:
                        continue
                    fname = _safe_name(iu)
                    if fname in seen_files:
                        stem, ext = os.path.splitext(fname)
                        fname = f"{stem}_{len(saved)}{ext}"
                    seen_files.add(fname)
                    fpath = os.path.join(out_images, fname)
                    with open(fpath, "wb") as f:
                        f.write(body)
                    saved.append(fpath)
                    page_saved += 1
                except Exception:
                    pass
            log(f"  [{len(visited)}] {url}  → {page_saved}장 (누적 {len(saved)})")

            # 링크 확장 (스코프 내)
            if max_pages <= 0 or len(visited) < max_pages:
                try:
                    links = await page.evaluate(EXTRACT_LINKS)
                except Exception:
                    links = []
                for ln in links:
                    lk = ln.split("#")[0]
                    if lk not in visited and lk not in queue and in_scope(lk):
                        queue.append(lk)

        await browser.close()

    return saved


def collect_from_dir(root: str) -> list[str]:
    paths = []
    for dp, _, files in os.walk(root):
        for f in files:
            if f.lower().endswith(IMG_EXT):
                paths.append(os.path.join(dp, f))
    return sorted(paths)


# ════════════════════════════════════════════════════════════
#  2) 후처리 측정 (이미지 1장 → 지표 dict)
# ════════════════════════════════════════════════════════════

def _laplacian_var(L: np.ndarray) -> float:
    """3x3 라플라시안 분산 — 샤프닝/아쿠턴스 (높을수록 선명·과샤프)."""
    a = L
    lap = (-4 * a[1:-1, 1:-1]
           + a[:-2, 1:-1] + a[2:, 1:-1]
           + a[1:-1, :-2] + a[1:-1, 2:])
    return float(lap.var())


def _grad_mag(L: np.ndarray) -> np.ndarray:
    gx = np.zeros_like(L); gy = np.zeros_like(L)
    gx[:, 1:-1] = L[:, 2:] - L[:, :-2]
    gy[1:-1, :] = L[2:, :] - L[:-2, :]
    return np.sqrt(gx * gx + gy * gy)


def analyze_image(path: str) -> dict | None:
    try:
        im = Image.open(path)
        im.load()
    except Exception:
        return None

    # 애니메이션/모드 정리
    if im.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        try:
            im = im.convert("RGBA"); bg.paste(im, mask=im.split()[-1]); im = bg
        except Exception:
            im = im.convert("RGB")
    else:
        im = im.convert("RGB")

    W0, H0 = im.size
    if W0 < MIN_IMAGE_DIM or H0 < MIN_IMAGE_DIM:
        return None

    # 도미넌트 팔레트 (원본에 가깝게 — 다운스케일 256)
    pal_src = im.copy()
    pal_src.thumbnail((256, 256))
    palette = _dominant_palette(pal_src, PALETTE_COLORS)

    # 분석용 다운스케일
    im_a = im.copy()
    im_a.thumbnail((ANALYZE_MAX_DIM, ANALYZE_MAX_DIM))
    Wa, Ha = im_a.size
    arr = np.asarray(im_a, dtype=np.float64)            # H,W,3  (0-255, gamma space)
    R, G, B = arr[..., 0], arr[..., 1], arr[..., 2]
    L = 0.2126 * R + 0.7152 * G + 0.0722 * B            # 휘도

    # HSV (PIL — H,S,V 0-255)
    hsv = np.asarray(im_a.convert("HSV"), dtype=np.float64)
    Hh, Ss, Vv = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    Lf = L.flatten()
    p01, p50, p99 = np.percentile(Lf, [1, 50, 99])

    # ── 톤 / 노출 ──
    exposure   = float(L.mean() / 255)
    contrast   = float(L.std() / 255)
    black_pt   = float(p01 / 255)                       # 높으면 = 블랙 리프트(matte/페이드)
    white_pt   = float(p99 / 255)
    dyn_range  = float((p99 - p01) / 255)
    shadow_clip = float((L < 2).mean())
    high_clip   = float((L > 253).mean())
    midtone     = float(p50 / 255)

    # ── 색온도 / 틴트 ──
    mR, mG, mB = float(R.mean()), float(G.mean()), float(B.mean())
    temp = (mR - mB) / 255                               # +웜 / -쿨
    tint = (mG - (mR + mB) / 2) / 255                    # +그린 / -마젠타

    # ── 채도 ──
    saturation = float(Ss.mean() / 255)
    sat_std    = float(Ss.std() / 255)

    # ── split-tone (셰도우 vs 하이라이트 색 캐스트) ──
    t_lo, t_hi = np.percentile(Lf, [25, 75])
    sh = L <= t_lo
    hl = L >= t_hi
    def _cast(mask):
        if mask.sum() < 16:
            return 0.0, 0.0, 0.0
        r, g, b = R[mask].mean(), G[mask].mean(), B[mask].mean()
        return (r - b) / 255, (g - (r + b) / 2) / 255, float(Ss[mask].mean() / 255)
    sh_temp, sh_tint, sh_sat = _cast(sh)
    hl_temp, hl_tint, hl_sat = _cast(hl)
    split_tone = hl_temp - sh_temp                       # >0: 하이라이트 웜 + 셰도우 쿨 (틸-오렌지)

    # ── 비네팅 (중심 vs 코너) ──
    cy0, cy1 = int(Ha * 0.35), int(Ha * 0.65)
    cx0, cx1 = int(Wa * 0.35), int(Wa * 0.65)
    center_L = float(L[cy0:cy1, cx0:cx1].mean()) if cy1 > cy0 and cx1 > cx0 else float(L.mean())
    cs = max(8, min(Ha, Wa) // 6)
    corners = np.concatenate([L[:cs, :cs].ravel(), L[:cs, -cs:].ravel(),
                              L[-cs:, :cs].ravel(), L[-cs:, -cs:].ravel()])
    corner_L = float(corners.mean())
    vignette = (corner_L - center_L) / (center_L + 1e-6)  # <0: 코너 어두움(비네팅)

    # ── 그레인 / 노이즈 (필름 그레인) ──
    med = np.asarray(im_a.convert("L").filter(ImageFilter.MedianFilter(3)), dtype=np.float64)
    resid = L - med
    gm = _grad_mag(L)
    flat = gm < np.percentile(gm, 40)                    # 평탄 영역만 → 진짜 노이즈
    noise_sigma = float(resid[flat].std()) if flat.sum() > 32 else float(resid.std())

    # ── 샤프닝 / 로컬 대비 ──
    acutance = _laplacian_var(L)                         # 절대값 (0~ 수백)
    blur = np.asarray(im_a.convert("L").filter(ImageFilter.GaussianBlur(8)), dtype=np.float64)
    local_contrast = float((L - blur).std() / 255)       # 클래리티/구조

    return {
        "file": path,
        "width": W0, "height": H0,
        "aspect": round(W0 / H0, 3),
        "exposure": round(exposure, 4),
        "contrast": round(contrast, 4),
        "black_point": round(black_pt, 4),
        "white_point": round(white_pt, 4),
        "dynamic_range": round(dyn_range, 4),
        "midtone": round(midtone, 4),
        "shadow_clip": round(shadow_clip, 5),
        "highlight_clip": round(high_clip, 5),
        "temp": round(temp, 4),
        "tint": round(tint, 4),
        "saturation": round(saturation, 4),
        "sat_std": round(sat_std, 4),
        "shadow_temp": round(sh_temp, 4),
        "highlight_temp": round(hl_temp, 4),
        "split_tone": round(split_tone, 4),
        "vignette": round(vignette, 4),
        "noise_sigma": round(noise_sigma, 4),
        "acutance": round(acutance, 2),
        "local_contrast": round(local_contrast, 4),
        "mean_rgb": [round(mR, 1), round(mG, 1), round(mB, 1)],
        "palette": palette,
    }


def _dominant_palette(im: Image.Image, k: int) -> list[dict]:
    """적응 양자화로 도미넌트 색 + 비율(hex)."""
    try:
        q = im.quantize(colors=k, method=Image.Quantize.FASTOCTREE)
    except Exception:
        q = im.convert("P", palette=Image.ADAPTIVE, colors=k)
    pal = q.getpalette()
    counts = q.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    out = []
    for cnt, idx in sorted(counts, reverse=True):
        r, g, b = pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2]
        out.append({"hex": f"#{r:02x}{g:02x}{b:02x}", "rgb": [r, g, b],
                    "ratio": round(cnt / total, 3)})
    return out[:k]


# ════════════════════════════════════════════════════════════
#  3) 컨셉 클러스터링 (k-means, numpy 자체구현)
# ════════════════════════════════════════════════════════════

# 클러스터링에 쓰는 "룩" 특징 (후처리 정체성을 가르는 축)
CLUSTER_KEYS = ["exposure", "contrast", "black_point", "saturation", "temp", "tint",
                "split_tone", "vignette", "noise_sigma", "local_contrast", "midtone"]


def _feature_matrix(records: list[dict]) -> np.ndarray:
    X = np.array([[r[k] for k in CLUSTER_KEYS] for r in records], dtype=np.float64)
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd < 1e-9] = 1.0
    return (X - mu) / sd                                  # z-score 표준화


def _kmeans(X: np.ndarray, k: int, seed: int = 0, iters: int = 60):
    rng = np.random.default_rng(seed)
    n = len(X)
    # k-means++ 초기화
    centers = [X[rng.integers(n)]]
    for _ in range(1, k):
        d2 = np.min([((X - c) ** 2).sum(1) for c in centers], axis=0)
        probs = d2 / (d2.sum() + 1e-12)
        centers.append(X[rng.choice(n, p=probs)])
    C = np.array(centers)
    labels = np.zeros(n, dtype=int)
    for _ in range(iters):
        D = ((X[:, None, :] - C[None, :, :]) ** 2).sum(2)
        new = D.argmin(1)
        if np.array_equal(new, labels):
            break
        labels = new
        for j in range(k):
            pts = X[labels == j]
            if len(pts):
                C[j] = pts.mean(0)
    inertia = float(sum(((X[labels == j] - C[j]) ** 2).sum() for j in range(k)))
    return labels, inertia


def _silhouette(X: np.ndarray, labels: np.ndarray) -> float:
    n = len(X)
    uniq = np.unique(labels)
    if len(uniq) < 2 or len(uniq) >= n:
        return -1.0
    D = np.sqrt(((X[:, None, :] - X[None, :, :]) ** 2).sum(2))
    s = np.zeros(n)
    for i in range(n):
        same = labels == labels[i]
        same[i] = False
        a = D[i, same].mean() if same.any() else 0.0
        b = min(D[i, labels == c].mean() for c in uniq if c != labels[i])
        s[i] = (b - a) / (max(a, b) + 1e-12)
    return float(s.mean())


def choose_clusters(records: list[dict], forced_k: int | None):
    """컨셉 개수 자동 결정 (실루엣). forced_k 주면 강제. 단일 룩이면 1."""
    n = len(records)
    X = _feature_matrix(records)
    if forced_k:
        k = max(1, min(forced_k, n))
        if k == 1:
            return np.zeros(n, dtype=int), X, 1
        labels, _ = _kmeans(X, k)
        return labels, X, k
    if n < 4:
        return np.zeros(n, dtype=int), X, 1

    best = (1, -1.0, np.zeros(n, dtype=int))
    for k in range(2, min(MAX_CLUSTERS, n - 1) + 1):
        # 시드 여러개 → 최저 inertia 채택
        cand = min((_kmeans(X, k, seed=s) for s in range(4)), key=lambda t: t[1])
        sil = _silhouette(X, cand[0])
        if sil > best[1]:
            best = (k, sil, cand[0])
    # 실루엣이 약하면 단일 컨셉으로 (과분할 방지)
    if best[1] < 0.18:
        return np.zeros(n, dtype=int), X, 1
    return best[2], X, best[0]


# ════════════════════════════════════════════════════════════
#  4) 숫자 → 사람이 읽는 후처리 해석
# ════════════════════════════════════════════════════════════

def _agg(records: list[dict]) -> dict:
    keys = ["exposure", "contrast", "black_point", "white_point", "dynamic_range",
            "midtone", "shadow_clip", "highlight_clip", "temp", "tint", "saturation",
            "sat_std", "shadow_temp", "highlight_temp", "split_tone", "vignette",
            "noise_sigma", "acutance", "local_contrast"]
    out = {k: round(float(np.mean([r[k] for r in records])), 4) for k in keys}
    out["count"] = len(records)
    # 팔레트 병합 (ratio 가중)
    bag: dict[str, list] = {}
    for r in records:
        for c in r["palette"]:
            bag.setdefault(c["hex"], [c["rgb"], 0.0])
            bag[c["hex"]][1] += c["ratio"]
    merged = sorted(bag.items(), key=lambda kv: kv[1][1], reverse=True)[:PALETTE_COLORS]
    tot = sum(v[1] for _, v in merged) or 1
    out["palette"] = [{"hex": h, "rgb": v[0], "ratio": round(v[1] / tot, 3)} for h, v in merged]
    return out


def interpret(a: dict) -> list[str]:
    """집계 지표를 후처리 동작 설명(불릿)으로 번역."""
    notes = []

    # 노출
    if a["exposure"] > 0.62:
        notes.append(f"**High-key / 밝은 노출** — 평균 휘도 {a['exposure']*100:.0f}%. 하이톤 위주, 공기감.")
    elif a["exposure"] < 0.34:
        notes.append(f"**Low-key / 어두운 노출** — 평균 휘도 {a['exposure']*100:.0f}%. 무드·드라마틱.")
    else:
        notes.append(f"노출 중립 (평균 휘도 {a['exposure']*100:.0f}%).")

    # 블랙 리프트 / matte
    if a["black_point"] > 0.14:
        notes.append(f"**블랙 리프트(matte/페이드 룩)** — 블랙포인트가 0이 아니라 {a['black_point']*255:.0f}/255까지 들림. "
                     f"필름·빈티지 톤 커브에서 자주 보임.")
    elif a["black_point"] < 0.03 and a["shadow_clip"] > 0.02:
        notes.append(f"**딥 블랙(크러시드 섀도)** — 블랙포인트 ≈0, 섀도 클리핑 {a['shadow_clip']*100:.1f}%. 단단한 대비.")

    # 대비
    if a["contrast"] > 0.26:
        notes.append(f"**고대비** — 휘도 표준편차 {a['contrast']:.2f}. 펀치감 강한 톤.")
    elif a["contrast"] < 0.15:
        notes.append(f"**저대비(소프트)** — 휘도 표준편차 {a['contrast']:.2f}. 평탄·부드러운 톤.")

    # 색온도 / 틴트
    if a["temp"] > 0.05:
        notes.append(f"**웜 화이트밸런스** — R−B +{a['temp']*255:.0f}. 따뜻한 골든 톤.")
    elif a["temp"] < -0.05:
        notes.append(f"**쿨 화이트밸런스** — R−B {a['temp']*255:.0f}. 차갑고 푸른 톤.")
    if abs(a["tint"]) > 0.03:
        notes.append(f"틴트 {'그린' if a['tint']>0 else '마젠타'} 쪽으로 {abs(a['tint'])*255:.0f} 치우침.")

    # split-tone (틸-오렌지 등 시네마틱 컬러그레이딩)
    if a["split_tone"] > 0.04:
        notes.append(f"**Split-tone (틸-오렌지 계열)** — 하이라이트는 웜(+{a['highlight_temp']*255:.0f}), "
                     f"섀도는 쿨({a['shadow_temp']*255:.0f}). 시네마틱 컬러그레이딩의 전형.")
    elif a["split_tone"] < -0.04:
        notes.append(f"**역 split-tone** — 하이라이트 쿨 / 섀도 웜. 차분한 무드 그레이딩.")

    # 채도
    if a["saturation"] > 0.5:
        notes.append(f"**고채도/비비드** — 평균 채도 {a['saturation']*100:.0f}%. 강렬·팝.")
    elif a["saturation"] < 0.22:
        notes.append(f"**저채도/디새추레이트** — 평균 채도 {a['saturation']*100:.0f}%. 뮤트·미니멀 톤.")
    else:
        notes.append(f"채도 중간 ({a['saturation']*100:.0f}%).")

    # 비네팅
    if a["vignette"] < -0.06:
        notes.append(f"**비네팅** — 코너가 중심보다 {abs(a['vignette'])*100:.0f}% 어두움. 시선 집중 효과.")
    elif a["vignette"] > 0.06:
        notes.append(f"역비네팅(코너 밝음) {a['vignette']*100:.0f}% — 하이키 배경/그라데이션 가능성.")

    # 그레인 / 노이즈
    if a["noise_sigma"] > 4.0:
        notes.append(f"**필름 그레인/노이즈 추가** — 평탄부 노이즈 σ≈{a['noise_sigma']:.1f}. 아날로그 질감.")
    elif a["noise_sigma"] < 1.2:
        notes.append(f"매우 클린(노이즈 σ≈{a['noise_sigma']:.1f}) — 노이즈 리덕션/디지털 클린 룩.")

    # 샤프닝 / 클래리티
    if a["acutance"] > 120:
        notes.append(f"**강한 샤프닝/클래리티** — 아쿠턴스 {a['acutance']:.0f}, 로컬 대비 {a['local_contrast']:.2f}. 또렷·구조 강조.")
    elif a["acutance"] < 25:
        notes.append(f"**소프트/약한 샤프닝** — 아쿠턴스 {a['acutance']:.0f}. 부드러운 디테일(또는 저해상 소스).")

    # 클리핑 경고
    if a["highlight_clip"] > 0.05:
        notes.append(f"하이라이트 클리핑 {a['highlight_clip']*100:.1f}% — 의도적 블로운 하이라이트 가능성.")

    return notes


def one_line_look(a: dict) -> str:
    """컨셉을 한 줄 라벨로."""
    parts = []
    parts.append("밝은" if a["exposure"] > 0.6 else "어두운" if a["exposure"] < 0.36 else "중간 노출")
    parts.append("고대비" if a["contrast"] > 0.25 else "저대비" if a["contrast"] < 0.16 else "중간대비")
    parts.append("웜" if a["temp"] > 0.04 else "쿨" if a["temp"] < -0.04 else "중성")
    parts.append("비비드" if a["saturation"] > 0.48 else "뮤트" if a["saturation"] < 0.24 else "")
    extra = []
    if a["black_point"] > 0.14: extra.append("matte")
    if a["split_tone"] > 0.04: extra.append("틸-오렌지")
    if a["noise_sigma"] > 4.0: extra.append("그레인")
    if a["vignette"] < -0.06: extra.append("비네팅")
    label = " · ".join(p for p in parts if p)
    if extra:
        label += "  (" + ", ".join(extra) + ")"
    return label


# ════════════════════════════════════════════════════════════
#  5) 시각 산출물 (팔레트 스와치 / 컨택트시트)
# ════════════════════════════════════════════════════════════

def render_palette(palette: list[dict], path: str, w: int = 900, h: int = 120):
    img = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(img)
    x = 0
    for c in palette:
        seg = max(1, int(round(c["ratio"] * w)))
        d.rectangle([x, 0, x + seg, h], fill=tuple(c["rgb"]))
        # hex 라벨 (밝기에 따라 글자색)
        lum = 0.2126*c["rgb"][0] + 0.7152*c["rgb"][1] + 0.0722*c["rgb"][2]
        fg = (0, 0, 0) if lum > 140 else (255, 255, 255)
        if seg > 60:
            d.text((x + 6, h - 18), f"{c['hex']}  {c['ratio']*100:.0f}%", fill=fg)
        x += seg
    img.save(path)


def render_contact(records: list[dict], path: str, cols: int = 5, cell: int = 220, cap: int = 15):
    sel = records[:cap]
    if not sel:
        return
    rows = math.ceil(len(sel) / cols)
    sheet = Image.new("RGB", (cols * cell, rows * cell), (245, 245, 245))
    for i, r in enumerate(sel):
        try:
            t = Image.open(r["file"]).convert("RGB")
            t.thumbnail((cell - 10, cell - 10))
        except Exception:
            continue
        cx = (i % cols) * cell + (cell - t.width) // 2
        cy = (i // cols) * cell + (cell - t.height) // 2
        sheet.paste(t, (cx, cy))
    sheet.save(path)


# ════════════════════════════════════════════════════════════
#  6) 리포트
# ════════════════════════════════════════════════════════════

def _md_palette(palette: list[dict]) -> str:
    return " ".join(f"`{c['hex']}`({c['ratio']*100:.0f}%)" for c in palette)


def build_report(records: list[dict], labels: np.ndarray, k: int, out_dir: str, source: str):
    overall = _agg(records)
    render_palette(overall["palette"], os.path.join(out_dir, "palette_overall.png"))

    # 컨셉별
    clusters = []
    for j in range(k):
        idx = [i for i in range(len(records)) if labels[i] == j]
        if not idx:
            continue
        recs = [records[i] for i in idx]
        ag = _agg(recs)
        # 클러스터 중심에 가까운 대표순 정렬 (대비*채도 변동 작은 것 우선 → 전형성)
        recs_sorted = sorted(recs, key=lambda r: abs(r["contrast"] - ag["contrast"]) + abs(r["saturation"] - ag["saturation"]))
        cid = len(clusters) + 1
        render_palette(ag["palette"], os.path.join(out_dir, f"palette_concept_{cid}.png"))
        render_contact(recs_sorted, os.path.join(out_dir, f"contact_concept_{cid}.png"))
        clusters.append({"id": cid, "agg": ag, "label": one_line_look(ag),
                         "notes": interpret(ag), "records": recs_sorted})

    clusters.sort(key=lambda c: c["agg"]["count"], reverse=True)

    # analysis.json
    payload = {
        "source": source,
        "image_count": len(records),
        "concept_count": len(clusters),
        "overall": {"agg": overall, "notes": interpret(overall), "label": one_line_look(overall)},
        "concepts": [{"id": c["id"], "label": c["label"], "count": c["agg"]["count"],
                      "agg": c["agg"], "notes": c["notes"],
                      "files": [os.path.basename(r["file"]) for r in c["records"]]} for c in clusters],
        "images": records,
    }
    with open(os.path.join(out_dir, "analysis.json"), "w") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # report.md
    L = []
    L.append("# 사진 후처리 디자인 스터디\n")
    L.append(f"- **소스**: {source}")
    L.append(f"- **분석 사진 수**: {len(records)}장")
    L.append(f"- **감지된 컨셉(룩) 수**: {len(clusters)}개")
    L.append(f"- **전체 룩 한 줄 요약**: {one_line_look(overall)}\n")

    L.append("## 전체 후처리 레시피 (일반 경향)\n")
    L.append("이 사이트 사진들이 공통적으로 거친 것으로 보이는 후처리:\n")
    for n in interpret(overall):
        L.append(f"- {n}")
    L.append("")
    L.append(f"**전체 도미넌트 팔레트**: {_md_palette(overall['palette'])}")
    L.append("\n![overall palette](palette_overall.png)\n")

    L.append("## 컨셉별 분류\n")
    if len(clusters) == 1:
        L.append("사진들이 하나의 일관된 후처리 룩으로 묶임 (위 전체 레시피와 동일).\n")
    else:
        L.append(f"후처리 특성(노출·대비·색온도·채도·split-tone·그레인·비네팅 등)으로 묶으니 **{len(clusters)}개 컨셉**으로 갈림:\n")

    for c in clusters:
        L.append(f"### 컨셉 {c['id']} — {c['label']}  ({c['agg']['count']}장)\n")
        for n in c["notes"]:
            L.append(f"- {n}")
        L.append("")
        L.append(f"**팔레트**: {_md_palette(c['agg']['palette'])}")
        L.append(f"\n![concept {c['id']} palette](palette_concept_{c['id']}.png)")
        if os.path.exists(os.path.join(out_dir, f"contact_concept_{c['id']}.png")):
            L.append(f"\n![concept {c['id']} samples](contact_concept_{c['id']}.png)")
        L.append("\n<details><summary>측정값 요약</summary>\n")
        ag = c["agg"]
        L.append("| 지표 | 값 |\n|---|---|")
        for key, lab in [("exposure", "노출"), ("contrast", "대비"), ("black_point", "블랙포인트"),
                         ("dynamic_range", "다이내믹레인지"), ("temp", "색온도(R−B)"), ("tint", "틴트"),
                         ("saturation", "채도"), ("split_tone", "split-tone"), ("vignette", "비네팅"),
                         ("noise_sigma", "노이즈σ"), ("acutance", "아쿠턴스"), ("local_contrast", "로컬대비")]:
            L.append(f"| {lab} | {ag[key]} |")
        L.append("\n</details>\n")
        sample_files = ", ".join(f"`{os.path.basename(r['file'])}`" for r in c["records"][:8])
        L.append(f"대표 파일: {sample_files}\n")

    L.append("---\n")
    L.append("*측정은 sRGB(감마) 공간 통계 기반의 추정이며, 원본 편집 설정값이 아니라 결과물에서 역추적한 후처리 지문입니다. "
             "디자인 레퍼런스/스터디 용도로 사용하세요.*\n")

    with open(os.path.join(out_dir, "report.md"), "w") as f:
        f.write("\n".join(L))

    return payload


# ════════════════════════════════════════════════════════════
#  7) 오케스트레이션
# ════════════════════════════════════════════════════════════

def run_analysis(image_paths: list[str], out_dir: str, source: str, forced_k: int | None):
    os.makedirs(out_dir, exist_ok=True)
    log(f"\n분석 시작 — 후보 {len(image_paths)}장")
    records = []
    for i, p in enumerate(image_paths, 1):
        try:
            if os.path.getsize(p) < MIN_FILE_BYTES:
                continue
        except OSError:
            continue
        r = analyze_image(p)
        if r:
            records.append(r)
        if i % 25 == 0:
            log(f"  …{i}/{len(image_paths)} (유효 {len(records)})")

    if not records:
        log("[ERROR] 분석 가능한 사진이 없습니다 (너무 작거나 손상). 스코프/폴더를 확인하세요.")
        sys.exit(2)

    log(f"유효 사진 {len(records)}장 → 컨셉 클러스터링")
    labels, _X, k = choose_clusters(records, forced_k)
    log(f"컨셉 {k}개 감지 → 리포트 생성")
    build_report(records, labels, k, out_dir, source)
    log(f"\n완료! 산출물: {os.path.abspath(out_dir)}")
    log(f"  - report.md       (디자인 스터디 리포트)")
    log(f"  - analysis.json   (측정값 전체)")
    log(f"  - palette_*.png / contact_*.png")


def main():
    ap = argparse.ArgumentParser(
        description="사이트 사진 후처리 분석 — 수집 → 후처리 측정 → 컨셉 분류 → 디자인 스터디 리포트")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--from", dest="from_url", metavar="URL",
                     help="사이트에서 스코프 내 사진 직접 수집 (playwright 필요)")
    src.add_argument("--dir", dest="from_dir", metavar="PATH",
                     help="이미 받아둔 이미지 폴더 분석 (webSiteExporter --download-images 결과 등)")
    ap.add_argument("--output", "-o", default="./photo-study", help="출력 디렉터리 (기본 ./photo-study)")
    ap.add_argument("--clusters", "-k", type=int, default=None,
                    help="컨셉 개수 강제 (기본: 자동 감지, 1~%d)" % MAX_CLUSTERS)
    # 스코프 (--from 모드)
    ap.add_argument("--max-pages", "-m", type=int, default=30, help="(--from) 방문 페이지 상한 (0=무제한)")
    ap.add_argument("--path-prefix", default=None, help="(--from) 이 경로로 시작하는 URL만 (예: /work)")
    ap.add_argument("--allow-cross-origin", action="store_true", help="(--from) 외부 도메인 이미지/링크도 허용")
    ap.add_argument("--scroll-time", "-s", type=int, default=8, help="(--from) 페이지당 스크롤 시간(초)")
    args = ap.parse_args()

    out_dir = args.output
    os.makedirs(out_dir, exist_ok=True)

    if args.from_url:
        if not urlparse(args.from_url).scheme:
            log("[ERROR] --from URL 에 https:// 를 포함하세요.")
            sys.exit(1)
        img_dir = os.path.join(out_dir, "images")
        paths = asyncio.run(crawl_and_download(
            args.from_url, img_dir,
            same_origin=not args.allow_cross_origin,
            path_prefix=args.path_prefix,
            max_pages=args.max_pages,
            scroll_time=args.scroll_time))
        source = args.from_url
    else:
        if not os.path.isdir(args.from_dir):
            log(f"[ERROR] 폴더가 없습니다: {args.from_dir}")
            sys.exit(1)
        paths = collect_from_dir(args.from_dir)
        source = os.path.abspath(args.from_dir)

    run_analysis(paths, out_dir, source, args.clusters)


if __name__ == "__main__":
    main()
