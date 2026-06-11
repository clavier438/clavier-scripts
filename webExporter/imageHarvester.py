"""
imageHarvester — 페이지의 *비-썸네일* 이미지를 nav 카테고리 태그와 함께 다운로드.

webSiteExporter 의 부가 모듈 (PDF 캡처와 독립 — 살아있는 page 객체만 받으면 동작).
`--download-images` (raw 전수 다운로드) 와의 차이:

  1. **썸네일 제외**: 렌더/natural 크기가 둘 다 MIN_DIM 미만이면 skip (아이콘·썸네일 컷).
  2. **nav 카테고리 태그**: discover 단계에서 그 페이지가 속한 nav 카테고리를
     ① 파일 경로(`images/<category>/<page>/`)  ② `images/manifest.json`
     ③ (macOS) Finder 태그 로 부착 → 나중에 "이 이미지가 어느 메뉴에 있었나" 추적.

진입점(webSiteExporter) 외에서도 독립 호출 가능하도록 page-단위 순수 함수로 구성.
page.request 사용 → 페이지 쿠키/UA 유지(봇 차단 회피).
"""

import json
import os
import re
import subprocess
import sys
from urllib.parse import urlparse

# 썸네일 판정 임계: 렌더·natural 크기의 *양 변* 이 이 값 미만이면 썸네일/아이콘으로 보고 skip.
# (1500×80 배너처럼 한 변만 큰 것은 보존 — 양 변 모두 작을 때만 제외)
MIN_DIM = int(os.environ.get("WEBEXP_IMG_MIN_DIM", "200"))

# data: URI 외에도 흔한 비-사진 자원(트래킹 픽셀·스프라이트 아이콘)을 url 패턴으로 1차 배제.
_SKIP_URL_RE = re.compile(r"(sprite|icon|favicon|logo[-_]?sprite|1x1|pixel|spacer|blank)\.", re.IGNORECASE)


def slugify_category(label: str) -> str:
    """nav 라벨(앵커 텍스트 또는 path segment) → 파일시스템 안전 슬러그."""
    if not label:
        return "uncategorized"
    s = label.strip().lower()
    s = re.sub(r"[^\w\-]+", "-", s, flags=re.UNICODE)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:60] or "uncategorized"


# ── 후보 수집 (브라우저 컨텍스트) ──────────────────────────
_COLLECT_JS = r"""() => {
    const out = [];
    const abs = (u) => { try { return new URL(u, location.href).href; } catch(e) { return null; } };
    const push = (url, el, kind, nw, nh) => {
        const a = abs(url);
        if (!a || a.startsWith('data:')) return;
        let r = { width: 0, height: 0 };
        let cs = null;
        try { r = el.getBoundingClientRect(); cs = getComputedStyle(el); } catch(e) {}
        out.push({
            url: a, kind,
            nw: nw || 0, nh: nh || 0,
            dw: Math.round(r.width), dh: Math.round(r.height),
            filter:  cs ? cs.filter : 'none',
            blend:   cs ? cs.mixBlendMode : 'normal',
            opacity: cs ? parseFloat(cs.opacity) : 1,
        });
    };
    // 1) <img> — currentSrc(브라우저가 실제 선택한 해상도) 우선, natural 크기 동반
    document.querySelectorAll('img').forEach(img => {
        push(img.currentSrc || img.src, img, 'img', img.naturalWidth, img.naturalHeight);
    });
    // 2) <source srcset> — 마지막(보통 최대) 후보
    document.querySelectorAll('source[srcset]').forEach(src => {
        const cands = src.srcset.split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean);
        if (cands.length) push(cands[cands.length - 1], src.parentElement || src, 'source', 0, 0);
    });
    // 3) CSS background-image
    document.querySelectorAll('*').forEach(el => {
        let bg = 'none';
        try { bg = getComputedStyle(el).backgroundImage; } catch(e) { return; }
        if (!bg || bg === 'none') return;
        const re = /url\((["']?)([^"')]+)\1\)/g; let m;
        while ((m = re.exec(bg)) !== null) {
            if (m[2]) push(m[2], el, 'background', 0, 0);
        }
    });
    return out;
}"""


def _merge_candidates(raw: list) -> dict:
    """url 기준 dedupe — 같은 url 이면 가장 큰 크기 + 가장 보정 강한 fx 채택."""
    def fx_rank(c):
        return ((2 if c.get("filter", "none") not in ("none", None) else 0)
                + (1 if c.get("blend", "normal") not in ("normal", None) else 0)
                + (1 if (c.get("opacity", 1) or 1) < 1 else 0))

    merged: dict = {}
    for c in raw:
        u = c.get("url")
        if not u:
            continue
        cur = merged.get(u)
        if cur is None:
            merged[u] = dict(c)
            continue
        cur["nw"] = max(cur["nw"], c["nw"])
        cur["nh"] = max(cur["nh"], c["nh"])
        cur["dw"] = max(cur["dw"], c["dw"])
        cur["dh"] = max(cur["dh"], c["dh"])
        if fx_rank(c) > fx_rank(cur):
            cur["filter"], cur["blend"], cur["opacity"] = c["filter"], c["blend"], c["opacity"]
    return merged


def is_thumbnail(c: dict, min_dim: int = MIN_DIM) -> bool:
    """양 변(유효 크기 = max(natural, rendered)) 모두 min_dim 미만이면 썸네일."""
    eff_w = max(c.get("nw", 0), c.get("dw", 0))
    eff_h = max(c.get("nh", 0), c.get("dh", 0))
    # 크기 정보가 전혀 없으면(0,0) 판단 불가 → 보수적으로 보존(썸네일 아님 취급)
    if eff_w == 0 and eff_h == 0:
        return False
    return eff_w < min_dim and eff_h < min_dim


# ── Finder 태그 (macOS) ───────────────────────────────────
def _set_finder_tags(filepath: str, tags: list):
    if sys.platform != "darwin":
        return
    try:
        import plistlib
        plist = plistlib.dumps(tags, fmt=plistlib.FMT_BINARY)
        subprocess.run(
            ["xattr", "-wx", "com.apple.metadata:_kMDItemUserTags", plist.hex(), filepath],
            capture_output=True,
        )
    except Exception:
        pass


def _safe_filename(url: str, fallback_idx: int) -> str:
    name = os.path.basename(urlparse(url).path) or f"img-{fallback_idx}"
    name = re.sub(r"[^\w\-.]", "_", name)[:90]
    if not os.path.splitext(name)[1]:
        name += ".img"
    return name


# ── manifest (run 전체 누적) ──────────────────────────────
def _update_manifest(images_root: str, page_entry: dict):
    """images/manifest.json 에 페이지 단위 엔트리 append (sequential 실행 가정)."""
    path = os.path.join(images_root, "manifest.json")
    data = {"pages": []}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {"pages": []}
    data.setdefault("pages", [])
    # 같은 (category, page) 재실행 시 중복 방지 — 기존 제거 후 추가
    key = (page_entry["category"], page_entry["page"])
    data["pages"] = [p for p in data["pages"]
                     if (p.get("category"), p.get("page")) != key]
    data["pages"].append(page_entry)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ── 메인 진입 (page 단위) ─────────────────────────────────
async def harvest_images(page, output_dir: str, base_name: str,
                         category: str = "uncategorized", url: str = "",
                         min_dim: int = MIN_DIM, log=print) -> int:
    """page 의 비-썸네일 이미지를 images/<category>/<base_name>/ 에 다운로드.

    반환: 저장한 이미지 수. 카테고리/원본 url/웹단 fx 는 manifest.json + _webfx.json 에 기록.
    """
    cat_slug = slugify_category(category)
    try:
        raw = await page.evaluate(_COLLECT_JS)
    except Exception as e:
        log(f"  [harvest] 후보 수집 실패: {type(e).__name__}")
        return 0

    merged = _merge_candidates(raw or [])
    if not merged:
        log(f"  [harvest] 이미지 후보 0 ({base_name})")
        return 0

    kept, skipped_thumb, skipped_url = [], 0, 0
    for u, c in merged.items():
        if _SKIP_URL_RE.search(u):
            skipped_url += 1
            continue
        if is_thumbnail(c, min_dim):
            skipped_thumb += 1
            continue
        kept.append((u, c))

    if not kept:
        log(f"  [harvest] 비-썸네일 이미지 0 (썸네일 {skipped_thumb} 제외, {base_name})")
        return 0

    img_dir = os.path.join(output_dir, "images", cat_slug, base_name)
    os.makedirs(img_dir, exist_ok=True)

    saved = 0
    seen_names: set = set()
    webfx: dict = {}
    records: list = []
    for u, c in kept:
        try:
            resp = await page.request.get(u, timeout=20000)
            if not resp.ok:
                continue
            body = await resp.body()
            if not body:
                continue
            fname = _safe_filename(u, saved)
            if fname in seen_names:
                stem, ext = os.path.splitext(fname)
                fname = f"{stem}_{saved}{ext}"
            seen_names.add(fname)
            fpath = os.path.join(img_dir, fname)
            with open(fpath, "wb") as f:
                f.write(body)
            # 카테고리 + web fx 메타 (image-tagger 호환: dw/dh/filter/blend/opacity)
            webfx[fname] = {
                "category": cat_slug,
                "src": u,
                "nw": c["nw"], "nh": c["nh"], "dw": c["dw"], "dh": c["dh"],
                "filter": c["filter"], "blend": c["blend"], "opacity": c["opacity"],
            }
            records.append({"file": fname, "src": u, "kind": c["kind"],
                            "nw": c["nw"], "nh": c["nh"], "dw": c["dw"], "dh": c["dh"]})
            _set_finder_tags(fpath, ["web", "image", cat_slug])
            saved += 1
        except Exception:
            pass

    # 폴더 단위 _webfx.json (image-tagger 가 root 에서 읽음)
    try:
        with open(os.path.join(img_dir, "_webfx.json"), "w", encoding="utf-8") as f:
            json.dump(webfx, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    # run 전체 manifest 누적
    _update_manifest(
        os.path.join(output_dir, "images"),
        {
            "category": cat_slug,
            "category_label": category,
            "page": base_name,
            "url": url,
            "saved": saved,
            "skipped_thumbnails": skipped_thumb,
            "min_dim": min_dim,
            "images": records,
        },
    )

    log(f"  [harvest] {saved}장 → images/{cat_slug}/{base_name}/ "
        f"(썸네일 {skipped_thumb} 제외, url-skip {skipped_url}) [category={cat_slug}]")
    return saved
