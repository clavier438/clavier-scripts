#!/usr/bin/env python3
"""
site-icons.py — 사이트가 쓰는 아이콘 시스템 탐지 (design recon).

레퍼런스 사이트가 (1) 공개 아이콘 라이브러리를 쓰는지·무엇인지,
(2) 안 쓰면 자체 SVG 를 어떻게 전달하는지 (inline / sprite / icon-font) 를
raw HTML + 링크된 CSS 의 시그니처로 판별한다. study/books 레퍼런스 분석용.

방식: Wappalyzer 류 시그니처 매칭 — 라이브러리별 고유 class/font-family/CDN/web-component.
precision 우선 (오탐 < 미탐): 라이브러리 *이름/CDN/웹컴포넌트* 시그니처는 high,
class 접두사는 반드시 class="" 문맥 안에서만 매칭해 오탐을 줄인다.

시그니처 근거 (docs-first, 2026-06-04 확인):
  - Font Awesome v6/7: class fa-solid|regular|light|thin|brands, legacy fas/far/fal/fab/fat/fass,
    font-family "Font Awesome <N> Free/Pro/Brands".  https://docs.fontawesome.com/web/add-icons/how-to
  - Material Symbols: class material-symbols-outlined|rounded|sharp, legacy material-icons (Google Fonts).
    https://developers.google.com/fonts/docs/material_symbols
  - Lucide: class "lucide lucide-<name>", attr data-lucide (Feather 의 fork).  https://lucide.dev/guide/
    Feather: class "feather feather-<name>", data-feather.

한계 (정직하게):
  - raw HTML + 링크 CSS 만 본다 → JS 런타임 주입 아이콘 / 봇월 사이트는 0 신호가 나온다.
    그건 "아이콘 없음"이 아니라 "정적 HTML 에선 못 봄" 이다 (delivery 가 'none …' 로 표기됨). rendered-browser 모드는 v2.
  - 높은 inline-SVG + 라이브러리 0 = 손으로 그렸거나 빌드 때 인라인된 라이브러리(Lucide/Heroicons)일 수 있음.
    CDN 을 안 거치면 둘이 구분 안 됨 → SVG path 데이터 대조는 v2.

사용:
  webExporter/.venv/bin/python tools/site-icons.py https://example.com [URL2 ...]
  webExporter/.venv/bin/python tools/site-icons.py --csv tools/image-ref-brands.csv
  webExporter/.venv/bin/python tools/site-icons.py --json https://example.com
Pillow 불필요 — 표준 라이브러리만. 아무 .venv python 으로 실행 가능.
"""
import sys, os, re, csv, ssl, gzip, json, argparse
import urllib.request
from urllib.parse import urljoin, urlparse

# freshness (모든 .py tool 의 첫 import) — site-scraper.py 와 동일 패턴.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (없는 환경(OCI 등)에서도 동작하게 선택적)
except Exception:
    pass

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# (이름, [정규식...], 신뢰도). class 접두사형은 class="" 문맥을 요구해 오탐 차단.
LIBS = [
    ("Font Awesome", [
        r"font[-_ ]?awesome", r"fontawesome\.com",
        r'class="[^"]*\bfa-(solid|regular|light|thin|brands)\b',
        r'class="[^"]*\bfa[srlbt]\b[^"]*\bfa-',
    ], "high"),
    ("Material Symbols/Icons", [
        r"material-symbols-(outlined|rounded|sharp)",
        r'class="[^"]*\bmaterial-icons\b',
        r"googleapis\.com/(icon\?family=Material|css2\?family=Material\+(Icons|Symbols))",
    ], "high"),
    ("Lucide", [r'class="[^"]*\blucide\s+lucide-', r"\bdata-lucide\b", r"lucide(@|/dist|\.min\.js|-icons)"], "high"),
    ("Feather", [r'class="[^"]*\bfeather\s+feather-', r"\bdata-feather\b", r"feather[-.]icons"], "high"),
    ("Bootstrap Icons", [r"bootstrap-icons", r'class="[^"]*\bbi\s+bi-'], "high"),
    ("Phosphor", [r"phosphor[-.]?icons", r"@phosphor-icons", r'class="[^"]*\bph\s+ph-'], "high"),
    ("Tabler Icons", [r"tabler[-.]?icons", r"@tabler/icons", r'class="[^"]*\bti\s+ti-'], "high"),
    ("Remix Icon", [r"remixicon", r'class="[^"]*\bri-[a-z]'], "high"),
    ("Ionicons", [r"<ion-icon\b", r"\bionicons?\b"], "high"),
    ("Iconify", [r"<iconify-icon", r"@iconify", r"\biconify\b"], "med"),
    ("Heroicons", [r"\bheroicons?\b"], "med"),
    ("Eva Icons", [r"\beva-icons\b"], "med"),
    ("Themify", [r"\bthemify\b"], "med"),
]

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE  # 일부 레퍼런스 사이트 cert 문제 우회 (site-scraper 와 동일 관용)


def fetch(url, limit=900_000):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=12, context=_ctx) as r:
        raw = r.read(limit)
        if r.headers.get("Content-Encoding") == "gzip":
            try:
                raw = gzip.decompress(raw)
            except Exception:
                pass
        return raw.decode("utf-8", "ignore")


def detect(url):
    """returns dict: {url, error?, libs:[{name,confidence,sig}], svg, sprite, i_tag, delivery}"""
    try:
        html = fetch(url)
    except Exception as e:
        return {"url": url, "error": f"{type(e).__name__}: {str(e)[:60]}"}

    blob = html
    # 아이콘은 보통 번들 CSS 의 @font-face/클래스에 → 링크된 stylesheet 최대 2개 따라가 합본
    css = re.findall(r'<link[^>]+rel=["\']?stylesheet["\']?[^>]*href=["\']([^"\']+)', html, re.I)
    css += re.findall(r'<link[^>]+href=["\']([^"\']+\.css[^"\']*)["\'][^>]*stylesheet', html, re.I)
    for href in css[:2]:
        try:
            full = href if href.startswith("http") else ("https:" + href if href.startswith("//") else urljoin(url, href))
            blob += "\n" + fetch(full, 400_000)
        except Exception:
            pass

    hits = []
    for name, pats, conf in LIBS:
        for p in pats:
            m = re.search(p, blob, re.I)
            if m:
                hits.append({"name": name, "confidence": conf, "sig": m.group(0)[:32]})
                break

    svg = len(re.findall(r"<svg", html, re.I))
    sprite = len(re.findall(r'<use\b[^>]*(xlink:)?href=["\']?[^"\'#>]*#', html, re.I))
    i_tag = len(re.findall(r"<i\s[^>]*class=", html, re.I))

    if hits:
        delivery = "library"
    elif sprite >= 10:
        delivery = "custom SVG sprite system"
    elif svg >= 8:
        delivery = "custom inline SVG"
    elif i_tag >= 6:
        delivery = "icon font (unidentified)"
    elif svg + sprite + i_tag == 0:
        delivery = "none in static HTML (JS-rendered or blocked)"
    else:
        delivery = "minimal / mixed"

    return {"url": url, "libs": hits, "svg": svg, "sprite": sprite, "i_tag": i_tag, "delivery": delivery}


def label(url):
    try:
        return urlparse(url).hostname.replace("www.", "")[:16]
    except Exception:
        return url[:16]


def load_csv(path):
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            u = (r.get("url") or "").strip()
            if u:
                out.append(((r.get("name") or label(u)).strip(), u))
    return out


def main():
    ap = argparse.ArgumentParser(description="사이트 아이콘 시스템 탐지 (design recon)")
    ap.add_argument("urls", nargs="*", help="스캔할 URL (여러 개)")
    ap.add_argument("--csv", help="name,url[,note] CSV 에서 URL 읽기 (예: tools/image-ref-brands.csv)")
    ap.add_argument("--json", action="store_true", help="결과를 JSON 으로 출력 (파이프라인용)")
    args = ap.parse_args()

    targets = [(label(u), u) for u in args.urls]
    if args.csv:
        targets += load_csv(args.csv)
    if not targets:
        ap.error("URL 을 인자로 주거나 --csv 로 지정하라")

    results = []
    for name, url in targets:
        r = detect(url)
        r["name"] = name
        results.append(r)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 0

    print(f"{'site':16} {'icon library':24} {'delivery':34} {'svg/sprite/<i>'}")
    print("-" * 96)
    for r in results:
        if r.get("error"):
            print(f"{r['name']:16} ⛔ {r['error']}")
            continue
        libs = ", ".join(f"{h['name']}({h['confidence']})" for h in r["libs"]) or "—"
        cnt = f"{r['svg']}/{r['sprite']}/{r['i_tag']}"
        print(f"{r['name']:16} {libs:24} {r['delivery']:34} {cnt}")
        for h in r["libs"]:
            print(f"                 └ {h['name']}: “{h['sig']}”")
    return 0


if __name__ == "__main__":
    sys.exit(main())
