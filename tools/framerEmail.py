#!/usr/bin/env python3
# framerEmail — Framer 디자인(웹 URL) → 이메일-세이프 HTML (결정론, AI 0).
#
# 레퍼런스 클래스 (2026-06):
#   · CSS 인라인화 = 해결된 결정론 단계 (juice/premailer/css-inline).
#   · 레이아웃→테이블 = "제약된 입력에서만" 결정론 (Inky: <row>/<columns> 약속 문법만).
#   · "Framer→이메일" 전용 도구는 없음 (Webflow 위시리스트 수년째). 임의 레이아웃의
#     모델 갭 때문. → 우리는 *뉴스레터=세로 스택* 제약으로 그 갭을 우회한다.
#
# 결정론 근거 + 오토레이아웃 재현:
#   이메일은 "세로로 쌓인 블록". Framer 뉴스레터도 그 모양. → 렌더된 DOM 을 *세로
#   위치(top) 순* 으로 정렬하면 div 중첩과 무관하게 스택 구조가 잡힌다.
#   간격·정렬·인셋은 하드코딩하지 않는다 — *렌더된 실제 기하* 에서 읽는다:
#     · 블록 사이 세로 간격 = (다음 top) − (이전 bottom)   → 실제 여백 그대로
#     · 좌우 인셋 = (블록 left − 프레임 left) / 프레임폭     → %(비율) → 좁아지면 같이 좁아듦
#     · 폰트·간격 = 프레임폭→이메일폭 비율로 스케일          → 디자인 비율 보존(채움)
#   computed style(실제 색·폰트) 그대로 인라인 emit → 타이포 정확, 환각 0.
#
# 알려진 경계(설계상): 같은 top 의 2칼럼(나란히)은 아직 세로로 쌓임 — 가로 그리드 칸
#   분할은 후속 업그레이드. 단일 칼럼 + 가로 오프셋(1/3 시작 등)은 % 인셋으로 재현됨.
#
# 사용법:
#   framerEmail <url> [--out file.html] [--width 600] [--viewport N] [--no-open]

import argparse
import hashlib
import html as _html
import io
import os
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

# ── SVG 호스팅 (reuse-first: framer-sync 의 R2 버킷 + 워커 서빙 재사용) ──────────
# 이메일은 인라인 SVG/ data URI(Gmail) 를 못 띄움 → SVG 를 webp 로 래스터화해 호스팅하고
# <img> 로 참조한다(레퍼런스 클래스: caniemail). 호스팅 = 이미 있는 framer-sync R2 +
# /webp-cache/<key> 서빙 엔드포인트 재사용. 업로드는 doppler 가 CF 토큰 주입(wrangler).
R2_BUCKET = "framer-sync-webp-cache"
ICON_URL_BASE = "https://framer-sync-mukayu.hyuk439.workers.dev/webp-cache"
WRANGLER_REPO = os.path.expanduser("~/dev/clavier/platform-workers/framer-sync")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경에서도 동작하게 선택적)
except ImportError:
    pass

# ── playwright 진입 (webExporter venv 재사용, reuse-first) ────────────────────
REPO = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def _ensure_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
        return
    except ImportError:
        venv = os.path.join(REPO, "webExporter", ".venv", "bin", "python")
        if os.path.realpath(sys.executable) != os.path.realpath(venv) and os.path.exists(venv):
            os.execv(venv, [venv] + sys.argv)
        sys.exit("playwright 없음 — webExporter/.venv 확인")


# ── 색/마크 (의존성 0) ────────────────────────────────────────────────────────
def _c(code, s):
    return f"\033[{code}m{s}\033[0m" if sys.stdout.isatty() else s
def bold(s):  return _c("1", s)
def dim(s):   return _c("2", s)
def green(s): return _c("32", s)
def cyan(s):  return _c("36", s)
def red(s):   return _c("31", s)


# ── 1. 추출 — 렌더된 페이지를 위치+기하+computed style 블록으로 ──────────────────
EXTRACT_JS = r"""
() => {
  const out = [];
  const isBadge = (el) => {
    if (el.tagName === 'A' && /framer\.(com|link|website|app)/.test(el.getAttribute('href') || '')) return true;
    if (el.closest('#__framer-badge-container, [data-framer-badge]')) return true;
    return false;
  };
  const geo = (r) => ({ top: r.top + window.scrollY, left: r.left + window.scrollX,
                        width: Math.round(r.width), height: Math.round(r.height) });
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) continue;
    const r = el.getBoundingClientRect();
    if (isBadge(el)) continue;
    // 구분선 — 얇은 가로 라인(높이<=3, 폭>=60, 배경색 있음). 단아한 룰선.
    const bgc = cs.backgroundColor;
    if (r.height <= 3 && r.width >= 60 && bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') {
      out.push({ kind: 'divider', color: bgc, ...geo(r) });
      continue;
    }
    if (r.width < 2 || r.height < 2) continue;
    const g = geo(r);

    if (el.tagName === 'IMG' && (el.currentSrc || el.src)) {
      out.push({ kind: 'image', src: el.currentSrc || el.src, alt: el.alt || '', ...g });
      continue;
    }
    const bg = cs.backgroundImage || '';
    if (bg.startsWith('url(') && r.height > 40 && r.width > 40) {
      const m = bg.match(/url\(["']?(.*?)["']?\)/);
      if (m && /^https?:/.test(m[1])) { out.push({ kind: 'image', src: m[1], alt: '', ...g }); continue; }
    }
    const direct = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
    if (direct) {
      const link = el.closest('a');
      const btnEl = el.closest('a, button, [role="button"]');
      if (btnEl) {
        // 버튼 박스 스타일은 btnEl *또는 그 자손* 에 있다 (Framer 는 <a> 안 wrapper div 에 테두리).
        // 4면 모두 테두리(또는 배경) 가진 박스만 = 진짜 버튼. (위/아래만 = 구분선/아코디언 → 제외)
        // Framer 는 버튼 테두리를 종종 *pseudo-element(::after)* 에 둔다 → 본체+pseudo 둘 다 검사.
        let box = null;
        for (const cand of [btnEl, ...btnEl.querySelectorAll('*')]) {
          const cr = cand.getBoundingClientRect();
          if (cr.width < 40 || cr.height < 20) continue;
          for (const pseudo of [null, '::after', '::before']) {
            const cc = getComputedStyle(cand, pseudo);
            const hasBg = !pseudo && cc.backgroundColor && cc.backgroundColor !== 'rgba(0, 0, 0, 0)' && cc.backgroundColor !== 'transparent';
            const hasBorder = parseFloat(cc.borderTopWidth || '0') > 0 && parseFloat(cc.borderBottomWidth || '0') > 0
                              && parseFloat(cc.borderLeftWidth || '0') > 0 && parseFloat(cc.borderRightWidth || '0') > 0;
            if (hasBg || hasBorder) { box = { cc, cr, hasBg, hasBorder }; break; }
          }
          if (box) break;
        }
        if (box) {
          const hasArrow = !!btnEl.querySelector('svg');
          out.push({ kind: 'button', text: direct, href: btnEl.getAttribute('href') || '', hasArrow,
                     bg: box.hasBg ? box.cc.backgroundColor : '', color: cs.color,
                     borderRadius: box.cc.borderTopLeftRadius,
                     border: box.hasBorder ? (box.cc.borderTopWidth + ' solid ' + box.cc.borderTopColor) : '',
                     fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily,
                     letterSpacing: cs.letterSpacing, textTransform: cs.textTransform,
                     top: box.cr.top + window.scrollY, left: box.cr.left + window.scrollX,
                     width: Math.round(box.cr.width), height: Math.round(box.cr.height) });
          continue;
        }
      }
      out.push({ kind: 'text', text: direct, ...g,
                 fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color,
                 fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, textAlign: cs.textAlign,
                 letterSpacing: cs.letterSpacing, textTransform: cs.textTransform,
                 href: link ? (link.getAttribute('href') || '') : '' });
    }
  }
  return { blocks: out, pageBg: getComputedStyle(document.body).backgroundColor, title: document.title };
}
"""


# 독립 아이콘 SVG 태깅 — 버튼/배지 안은 제외(버튼 화살표는 unicode 처리됨).
ICON_TAG_JS = r"""
() => {
  let i = 0; const out = [];
  for (const s of document.querySelectorAll('svg')) {
    if (s.closest('a, button, [role="button"]')) continue;
    if (s.closest('#__framer-badge-container, [data-framer-badge]')) continue;
    const cs = getComputedStyle(s);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) continue;
    const r = s.getBoundingClientRect();
    if (r.width < 8 || r.width > 90 || r.height < 8) continue;
    s.setAttribute('data-fe-icon', String(i));
    out.push({ idx: i, top: r.top + window.scrollY, left: r.left + window.scrollX,
               width: Math.round(r.width), height: Math.round(r.height) });
    i++;
  }
  return out;
}
"""


def _rasterize_icons(page):
    # 독립 SVG 아이콘을 webp 로 래스터화(content-hash 중복제거). 이메일은 인라인 SVG 못 띄움.
    from PIL import Image
    icon_dir = tempfile.mkdtemp(prefix="fe-icons-")
    blocks = []
    for m in page.evaluate(ICON_TAG_JS):
        try:
            png = page.locator(f'[data-fe-icon="{m["idx"]}"]').screenshot()
        except Exception:
            continue
        im = Image.open(io.BytesIO(png)).convert("RGBA")
        buf = io.BytesIO(); im.save(buf, "WEBP"); wb = buf.getvalue()
        h = hashlib.sha1(wb).hexdigest()[:16]
        path = os.path.join(icon_dir, f"{h}.webp")
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(wb)
        blocks.append({"kind": "icon", "top": m["top"], "left": m["left"],
                       "width": m["width"], "height": m["height"], "hash": h, "path": path})
    return blocks


def extract(url, viewport_width, icons=True):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": viewport_width, "height": 1200}, device_scale_factor=2)
        page.goto(url, wait_until="networkidle", timeout=60000)
        page.evaluate("async () => { for (let y=0; y<document.body.scrollHeight; y+=600){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,80)); } window.scrollTo(0,0); }")
        page.wait_for_timeout(600)
        data = page.evaluate(EXTRACT_JS)
        if icons:
            data["blocks"].extend(_rasterize_icons(page))
        browser.close()
    return data


# ── 아이콘 업로드 — webp → R2(doppler CF토큰) → 워커 URL. content-hash 중복제거. ──
def upload_icons(blocks):
    """{hash: url|None}. 업로드 실패(인증/오프라인)면 None → 호출부가 graceful skip."""
    urls = {}
    uniq = {}
    for b in blocks:
        if b["kind"] == "icon":
            uniq[b["hash"]] = b["path"]
    if not uniq:
        return urls
    for h, path in uniq.items():
        key = f"fe-icons/{h}.webp"
        try:
            r = subprocess.run(
                ["doppler", "run", "--project", "clavier", "--config", "prd_mukayu", "--",
                 "npx", "wrangler", "r2", "object", "put", f"{R2_BUCKET}/{key}",
                 "--file", path, "--content-type", "image/webp", "--remote"],
                cwd=WRANGLER_REPO, capture_output=True, text=True, timeout=120)
            urls[h] = f"{ICON_URL_BASE}/{key}" if r.returncode == 0 else None
        except Exception:
            urls[h] = None
    return urls


# ── 2. 정규화 — 정렬·중복 이미지 제거·인접 동일스타일 텍스트 병합 ──────────────
def _px(v):
    m = re.match(r"([\d.]+)px", str(v)) if v else None
    return float(m.group(1)) if m else None


def _style_sig(b):
    return (b.get("fontSize"), b.get("fontWeight"), b.get("color"), b.get("textAlign"), b.get("href", ""))


def normalize(blocks):
    blocks = sorted(blocks, key=lambda b: (round(b["top"]), round(b["left"])))
    out = []
    seen_img = set()
    for b in blocks:
        b["bottom"] = b["top"] + b.get("height", 0)
        b["right"] = b["left"] + b.get("width", 0)
        if b["kind"] == "image":
            if b["src"] in seen_img:
                continue
            seen_img.add(b["src"])
            out.append(b)
        elif b["kind"] == "divider":
            # 같은 top 의 중복 라인 제거 (Framer 가 겹쳐 깔기도)
            if out and out[-1]["kind"] == "divider" and abs(b["top"] - out[-1]["top"]) < 3:
                continue
            out.append(b)
        elif b["kind"] == "text" and out and out[-1]["kind"] == "icon" \
                and out[-1]["left"] < b["left"] \
                and abs(out[-1]["top"] - b["top"]) < max(b.get("height", 20), out[-1].get("height", 20)) * 1.6:
            # 같은 행 왼쪽 아이콘 + 텍스트 → 인라인 결합 ("+ 아동 및 단체 정책")
            b["icon"] = out.pop()
            out.append(b)
        elif out and out[-1]["kind"] == "text" and b["kind"] == "text" \
                and _style_sig(out[-1]) == _style_sig(b) \
                and abs(b["top"] - out[-1]["bottom"]) < (_px(b["fontSize"]) or 20) * 1.4:
            out[-1]["text"] = (out[-1]["text"] + " " + b["text"]).strip()
            out[-1]["bottom"] = max(out[-1]["bottom"], b["bottom"])
            out[-1]["right"] = max(out[-1]["right"], b["right"])
        else:
            out.append(b)
    return out


# ── 3. 빌드 — 기하(간격·인셋)를 비율로 재현 + computed style inline ──────────────
def _font_stack(family):
    parts = [p.strip().replace('"', "'") for p in (family or "").split(",")]
    parts = [p for p in parts if p and "placeholder" not in p.lower()]
    fam = ", ".join(parts)
    serif = bool(re.search(r"serif", fam, re.I)) and not re.search(r"sans", fam, re.I)
    fallback = "Georgia, 'Times New Roman', serif" if serif \
        else "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
    return f"{fam}, {fallback}" if fam else fallback


class Frame:
    """프레임 = 모든 블록의 좌/우 경계. 인셋·폭을 이 비율로 환산."""
    def __init__(self, blocks):
        self.left = min(b["left"] for b in blocks)
        self.right = max(b["right"] for b in blocks)
        self.width = max(self.right - self.left, 1)

    def pct(self, x):  # 프레임폭 대비 % (가로 — 반응형으로 같이 좁아듦)
        return round(x / self.width * 1000) / 10

    def lpad(self, b):  # 좌 인셋 %
        return max(self.pct(b["left"] - self.left), 0)

    def rpad(self, b):  # 우 인셋 %
        return max(self.pct(self.right - b["right"]), 0)


def _gap_pad(gap_px, scale):
    return max(round(gap_px * scale), 0)


def _inline_icon(b, scale, icon_urls):
    ic = b.get("icon")
    if not ic or not icon_urls.get(ic["hash"]):
        return ""
    iw = round(ic["width"] * scale)
    return (f'<img src="{icon_urls[ic["hash"]]}" width="{iw}" '
            f'style="display:inline-block;width:{iw}px;height:auto;vertical-align:middle;margin-right:8px;border:0" />')


def _icon_row(b, frame, scale, icon_urls):
    url = icon_urls.get(b["hash"])
    if not url:
        return ""  # 업로드 실패 → graceful skip (이메일은 그래도 생성됨)
    w = round(b["width"] * scale)
    return f'<img src="{url}" width="{w}" style="display:block;width:{w}px;max-width:100%;height:auto;border:0" />'


def _text_row(b, frame, scale, icon_urls):
    size = round((_px(b["fontSize"]) or 16) * scale)
    weight = b.get("fontWeight") or "400"
    color = b.get("color") or "#1a1a1a"
    lh = _px(b.get("lineHeight"))
    lh_css = f"{round(lh * scale)}px" if lh else "1.5"
    align = b["textAlign"] if b.get("textAlign") in ("left", "center", "right") else "left"
    ls = _px(b.get("letterSpacing"))
    ls_css = f"letter-spacing:{round(ls*scale*100)/100}px;" if ls else ""
    tt = b.get("textTransform")
    tt_css = f"text-transform:{tt};" if tt and tt != "none" else ""
    style = (f"margin:0;padding:0;font-family:{_font_stack(b.get('fontFamily'))};"
             f"font-size:{size}px;font-weight:{weight};color:{color};line-height:{lh_css};"
             f"text-align:{align};{ls_css}{tt_css}")
    text = _html.escape(b["text"])
    if b.get("href"):
        text = f'<a href="{_html.escape(b["href"], quote=True)}" style="color:{color};text-decoration:none">{text}</a>'
    return f'<p style="{style}">{_inline_icon(b, scale, icon_urls)}{text}</p>'


def _image_row(b, frame, scale):
    # aspect 충실: Framer 는 자연비(3:2)를 *렌더박스 비율*(예 16:9)로 object-fit:cover crop.
    # → 렌더박스 W×H 로 aspect-ratio + cover 재현(자연비 그대로 풀로 늘어나지 않게).
    src = _html.escape(b["src"], quote=True)
    alt = _html.escape(b.get("alt", ""), quote=True)
    w = round(b["width"] * scale)
    h = round(b.get("height", 0) * scale)
    ar = f"aspect-ratio:{w}/{h};object-fit:cover;" if h else ""
    return (f'<img src="{src}" alt="{alt}" width="{w}" '
            f'style="display:block;width:100%;max-width:{w}px;{ar}height:auto;border:0" />')


def _divider_row(b, frame, scale):
    color = b.get("color") or "rgb(221,221,221)"
    h = max(round(b.get("height", 1) * scale), 1)
    return f'<div style="font-size:0;line-height:0;height:{h}px;background:{color}"></div>'


def _button_row(b, frame, scale):
    color = b.get("color") or "#1a1a1a"
    bg_css = f"background:{b['bg']};" if b.get("bg") else ""
    border_css = f"border:{b['border']};" if b.get("border") else ""
    radius = b.get("borderRadius") or "0px"
    size = round((_px(b.get("fontSize")) or 14) * scale)
    weight = b.get("fontWeight") or "600"
    tt = b.get("textTransform")
    tt_css = f"text-transform:{tt};" if tt and tt != "none" else ""
    ls = _px(b.get("letterSpacing"))
    ls_css = f"letter-spacing:{round(ls*scale*100)/100}px;" if ls else ""
    w = round(b.get("width", 0) * scale)
    # SVG 화살표는 메일에서 안 뜸 → unicode → 로 근사, 폭 있으면 우측 끝으로(float).
    arrow = '<span style="float:right">&rarr;</span>' if b.get("hasArrow") else ""
    text = _html.escape(b["text"]) + arrow
    href = _html.escape(b.get("href") or "#", quote=True)
    width_css = f"width:{w}px;max-width:100%;box-sizing:border-box;text-align:left;" if w >= 60 else ""
    pad_v = round(13 * scale)
    a_style = (f"display:inline-block;{bg_css}{border_css}border-radius:{radius};"
               f"padding:{pad_v}px 20px;color:{color};text-decoration:none;{width_css}"
               f"font-family:{_font_stack(b.get('fontFamily'))};font-size:{size}px;font-weight:{weight};{ls_css}{tt_css}")
    return f'<a href="{href}" style="{a_style}">{text}</a>'


def build_email(data, content_width=600, icon_urls=None):
    icon_urls = icon_urls or {}
    blocks = normalize(data["blocks"])
    if not blocks:
        return None
    frame = Frame(blocks)
    # 폰트·간격은 *네이티브 px 유지* (scale=1). 디자인을 억지로 넓혀 글자를 키우지 않는다
    # — 단아한 비율이 깨짐. 대신 이메일 max-width 를 디자인 실제 폭(frame.width, --width 로 캡)
    # 에 맞추고, 그 아래로는 % 인셋 + width:100% 로 같이 좁아듦(fill).
    scale = 1.0
    email_w = min(round(frame.width), content_width)
    page_bg = data.get("pageBg") or "#ffffff"
    if page_bg in ("rgba(0, 0, 0, 0)", "transparent"):
        page_bg = "#ffffff"

    rows = []
    prev_bottom = blocks[0]["top"]
    for i, b in enumerate(blocks):
        gap = _gap_pad(b["top"] - prev_bottom, scale) if i > 0 else 0
        prev_bottom = b["bottom"]
        lpad, rpad = frame.lpad(b), frame.rpad(b)
        # 이미지는 가로 인셋 0(풀블리드)이면 패딩 없이 꽉, 아니면 인셋 적용
        if b["kind"] == "image":
            inner = _image_row(b, frame, scale)
        elif b["kind"] == "button":
            inner = _button_row(b, frame, scale)
        elif b["kind"] == "divider":
            inner = _divider_row(b, frame, scale)
        elif b["kind"] == "icon":
            inner = _icon_row(b, frame, scale, icon_urls)
        else:
            inner = _text_row(b, frame, scale, icon_urls)
        if not inner:
            continue  # graceful skip (예: 업로드 실패한 아이콘)
        td_style = f"padding:{gap}px {rpad}% 0 {lpad}%;"
        rows.append(f'<tr><td style="{td_style}">{inner}</td></tr>')

    body_rows = "\n".join(rows)
    title = _html.escape(data.get("title") or "")
    # 반응형: 바깥 100% 유동 + 안쪽 max-width 캡 → 넓으면 캡, 좁으면 fill 로 같이 좁아듦.
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background:{page_bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:{page_bg}">
<tr><td align="center" style="padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:{email_w}px;margin:0 auto;background:{page_bg}">
{body_rows}
</table>
</td></tr>
</table>
</body>
</html>"""


# ── CLI ──────────────────────────────────────────────────────────────────────
def main():
    _ensure_playwright()
    ap = argparse.ArgumentParser(prog="framerEmail",
                                 description="Framer 디자인 URL → 이메일-세이프 HTML (결정론)")
    ap.add_argument("url", help="Framer 게시 URL")
    ap.add_argument("--out", help="출력 .html 경로 (기본: ./<host>-email.html)")
    ap.add_argument("--width", type=int, default=600, help="이메일 본문 폭 px (기본 600)")
    ap.add_argument("--viewport", type=int, help="렌더 뷰포트 폭 (기본=--width). 디자인이 특정 폭 기준이면 지정")
    ap.add_argument("--no-icons", action="store_true", help="SVG 아이콘 래스터화·업로드 skip (오프라인/빠르게)")
    ap.add_argument("--no-open", action="store_true", help="끝나고 브라우저로 열지 않음")
    args = ap.parse_args()

    host = urlparse(args.url).netloc.replace(".", "_") or "email"
    out_path = args.out or os.path.join(os.getcwd(), f"{host}-email.html")
    viewport = args.viewport or args.width

    print(f"{cyan('▶')} 추출: {args.url} (viewport {viewport}px)")
    data = extract(args.url, viewport, icons=not args.no_icons)
    n_text = sum(1 for b in data["blocks"] if b["kind"] == "text")
    n_img = sum(1 for b in data["blocks"] if b["kind"] == "image")
    n_btn = sum(1 for b in data["blocks"] if b["kind"] == "button")
    n_icon = sum(1 for b in data["blocks"] if b["kind"] == "icon")
    print(f"  블록 {len(data['blocks'])}개 (텍스트 {n_text} · 이미지 {n_img} · 버튼 {n_btn} · 아이콘 {n_icon})")

    icon_urls = {}
    if n_icon:
        print(f"{cyan('▶')} 아이콘 {n_icon}개 래스터화 → R2 업로드 중…")
        icon_urls = upload_icons(data["blocks"])
        ok = sum(1 for v in icon_urls.values() if v)
        print(f"  업로드 {ok}/{len(icon_urls)} (실패분은 graceful skip)")

    html = build_email(data, content_width=args.width, icon_urls=icon_urls)
    if not html:
        sys.exit(red("✗ 추출된 블록 0 — URL/렌더 확인"))
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{green('✓')} 이메일 HTML: {bold(out_path)}")
    print(dim("  → 스티비 [HTML 에디터로 만들기] 에 붙이거나, 그대로 발송"))

    if not args.no_open:
        import subprocess
        subprocess.run(["open", out_path], check=False)


if __name__ == "__main__":
    main()
