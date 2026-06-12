#!/usr/bin/env python3
# framerEmail — Framer 디자인(웹 URL) → 이메일-세이프 HTML (결정론, AI 0).
#
# 레퍼런스 클래스 (2026-06):
#   · CSS 인라인화 = 해결된 결정론 단계 (juice/premailer/css-inline).
#   · 레이아웃→테이블 = "제약된 입력에서만" 결정론 (Inky: <row>/<columns> 약속 문법만 변환).
#   · "Framer→이메일" 전용 도구는 없음 (Webflow 위시리스트 수년째). 임의 레이아웃의
#     모델 갭 때문. → 우리는 *뉴스레터=세로 블록* 제약으로 그 갭을 우회한다.
#
# 그래서 이 도구의 결정론 근거:
#   이메일은 어차피 "세로로 쌓인 full-width 블록". Framer 뉴스레터도 그 모양.
#   → DOM 을 *렌더된 세로 위치(top) 순*으로 정렬하면 div 중첩과 무관하게 구조가 잡힌다.
#   각 블록의 computed style(실제 색·폰트·크기)을 그대로 인라인으로 emit → 타이포 정확, 환각 0.
#   AI 는 "이상한 레이아웃" 안전망으로만 (--ai, 미구현 — 세로형은 결정론으로 충분).
#
# 사용법:
#   framerEmail <url> [--out file.html] [--width 600] [--no-open]
#
# 의존: webExporter/.venv 의 playwright(chromium). 인라인화 별도 불필요 — computed
#   style 을 처음부터 inline 으로 박으므로 (juice 류는 <style> 잔재용 안전망일 뿐).

import argparse
import html as _html
import os
import re
import sys
from urllib.parse import urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경에서도 동작하게 선택적)
except ImportError:
    pass

# ── playwright 진입 (webExporter venv 재사용, reuse-first) ────────────────────
# 이 도구 전용 venv 를 새로 만들지 않는다 — 이미 chromium 깔린 webExporter venv 를 쓴다.
REPO = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def _ensure_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
        return
    except ImportError:
        venv = os.path.join(REPO, "webExporter", ".venv", "bin", "python")
        if os.path.realpath(sys.executable) != os.path.realpath(venv) and os.path.exists(venv):
            os.execv(venv, [venv] + sys.argv)  # venv 파이썬으로 자기 재실행
        sys.exit("playwright 없음 — webExporter/.venv 확인")


# ── 색/마크 (의존성 0, brandRe 패턴) ─────────────────────────────────────────
def _c(code, s):
    return f"\033[{code}m{s}\033[0m" if sys.stdout.isatty() else s
def bold(s):  return _c("1", s)
def dim(s):   return _c("2", s)
def green(s): return _c("32", s)
def cyan(s):  return _c("36", s)
def red(s):   return _c("31", s)


# ── 1. 추출 — 렌더된 페이지를 세로 위치순 블록으로 ──────────────────────────────
# 페이지 안에서 실행되는 JS. 보이는 leaf 텍스트 + 이미지(img/background)를 모아
# 렌더 top 좌표와 computed style 과 함께 반환. div 중첩 무관 — 위치로 정렬한다.
EXTRACT_JS = r"""
() => {
  const out = [];
  const isBadge = (el) => {
    if (el.tagName === 'A' && /framer\.(com|link|website|app)/.test(el.getAttribute('href') || '')) return true;
    if (el.closest('#__framer-badge-container, [data-framer-badge]')) return true;
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (isBadge(el)) continue;
    const top = r.top + window.scrollY, left = r.left + window.scrollX;

    // 이미지 — <img>
    if (el.tagName === 'IMG' && (el.currentSrc || el.src)) {
      out.push({ kind: 'image', src: el.currentSrc || el.src, top, left,
                 width: Math.round(r.width), alt: el.alt || '' });
      continue;
    }
    // 이미지 — background-image (Framer 가 히어로를 이렇게 깔기도)
    const bg = cs.backgroundImage || '';
    if (bg.startsWith('url(') && r.height > 40 && r.width > 40) {
      const m = bg.match(/url\(["']?(.*?)["']?\)/);
      if (m && /^https?:/.test(m[1])) {
        out.push({ kind: 'image', src: m[1], top, left, width: Math.round(r.width), alt: '',
                   bgHeight: Math.round(r.height) });
        continue;
      }
    }
    // 텍스트 — 직속 텍스트 노드를 가진 leaf 만 (조상 중복 방지)
    const direct = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
    if (direct) {
      const link = el.closest('a');
      out.push({ kind: 'text', text: direct, top, left,
                 fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color,
                 fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, textAlign: cs.textAlign,
                 letterSpacing: cs.letterSpacing, textTransform: cs.textTransform,
                 href: link ? (link.getAttribute('href') || '') : '' });
    }
  }
  return { blocks: out, pageBg: getComputedStyle(document.body).backgroundColor, title: document.title };
}
"""


def extract(url, viewport_width=420):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": viewport_width, "height": 1200},
                                device_scale_factor=2)
        page.goto(url, wait_until="networkidle", timeout=60000)
        # lazy 콘텐츠 로드 유도 — 끝까지 스크롤 후 복귀
        page.evaluate("async () => { for (let y=0; y<document.body.scrollHeight; y+=600){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,80)); } window.scrollTo(0,0); }")
        page.wait_for_timeout(600)
        data = page.evaluate(EXTRACT_JS)
        browser.close()
    return data


# ── 2. 정규화 — 정렬·중복 이미지 제거·인접 동일스타일 텍스트 병합 ──────────────
def _style_sig(b):
    return (b["fontSize"], b["fontWeight"], b["color"], b["textAlign"], b.get("href", ""))


def normalize(blocks):
    # 세로 위치순 (같으면 좌->우)
    blocks = sorted(blocks, key=lambda b: (round(b["top"]), round(b.get("left", 0))))
    out = []
    seen_img = set()
    for b in blocks:
        if b["kind"] == "image":
            if b["src"] in seen_img:
                continue
            seen_img.add(b["src"])
            out.append(b)
            continue
        # 텍스트 — 직전 블록과 같은 스타일 + 가까우면 한 문단으로 병합 (Framer 의 줄 분할 대응)
        if out and out[-1]["kind"] == "text" and _style_sig(out[-1]) == _style_sig(b) \
           and abs(b["top"] - out[-1]["top"]) < float(_px(b["fontSize"]) or 20) * 2.2:
            out[-1]["text"] = (out[-1]["text"] + " " + b["text"]).strip()
        else:
            out.append(b)
    return out


def _px(v):
    if not v:
        return None
    m = re.match(r"([\d.]+)px", str(v))
    return float(m.group(1)) if m else None


# ── 3. 빌드 — 블록 → 테이블 기반 이메일 HTML (computed style 그대로 inline) ──────
def _font_stack(family):
    # Framer 커스텀 폰트는 메일에서 못 불러옴 → 실제 family + 합리적 폴백.
    # 주의 1: Framer 의 "X Placeholder" 항목은 폰트로딩 플레이스홀더 → 메일에선 무의미, 제거.
    # 주의 2: family 안 큰따옴표는 style="..." 속성을 깨므로 작은따옴표로.
    parts = [p.strip() for p in (family or "").split(",")]
    parts = [p.replace('"', "'") for p in parts if p and "placeholder" not in p.lower()]
    fam = ", ".join(parts)
    serif = bool(re.search(r"serif", fam, re.I)) and not re.search(r"sans", fam, re.I)
    fallback = "Georgia, 'Times New Roman', serif" if serif \
        else "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
    return f"{fam}, {fallback}" if fam else fallback


def _text_block(b, content_width):
    size = _px(b["fontSize"]) or 16
    weight = b["fontWeight"] or "400"
    color = b["color"] or "#1a1a1a"
    lh = b["lineHeight"]
    lh_css = lh if (lh and lh != "normal") else f"{round(size * 1.5)}px"
    align = b["textAlign"] if b["textAlign"] in ("left", "center", "right") else "left"
    ls = b["letterSpacing"]
    ls_css = f"letter-spacing:{ls};" if ls and ls not in ("normal", "0px") else ""
    tt = b["textTransform"]
    tt_css = f"text-transform:{tt};" if tt and tt != "none" else ""
    # 헤딩(큰 글씨)은 위 여백 넉넉히, 본문은 좁게
    pad_top = 0 if size >= 28 else 4
    style = (f"margin:0;padding:0;font-family:{_font_stack(b['fontFamily'])};"
             f"font-size:{round(size)}px;font-weight:{weight};color:{color};"
             f"line-height:{lh_css};text-align:{align};{ls_css}{tt_css}")
    text = _html.escape(b["text"])
    if b.get("href"):
        href = _html.escape(b["href"], quote=True)
        text = f'<a href="{href}" style="color:{color};text-decoration:none">{text}</a>'
    return (f'<tr><td style="padding:{pad_top}px 24px 12px 24px">'
            f'<p style="{style}">{text}</p></td></tr>')


def _image_block(b, content_width):
    src = _html.escape(b["src"], quote=True)
    alt = _html.escape(b.get("alt", ""), quote=True)
    return (f'<tr><td style="padding:12px 0">'
            f'<img src="{src}" alt="{alt}" width="{content_width}" '
            f'style="display:block;width:100%;max-width:{content_width}px;height:auto;border:0" /></td></tr>')


def build_email(data, content_width=600):
    blocks = normalize(data["blocks"])
    page_bg = data.get("pageBg") or "#ffffff"
    if page_bg in ("rgba(0, 0, 0, 0)", "transparent"):
        page_bg = "#ffffff"
    rows = []
    for b in blocks:
        rows.append(_image_block(b, content_width) if b["kind"] == "image"
                    else _text_block(b, content_width))
    body_rows = "\n".join(rows)
    title = _html.escape(data.get("title") or "")
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background:{page_bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{page_bg}">
<tr><td align="center" style="padding:24px 0">
<table role="presentation" width="{content_width}" cellpadding="0" cellspacing="0" border="0" style="width:{content_width}px;max-width:{content_width}px;background:{page_bg}">
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
    ap.add_argument("--no-open", action="store_true", help="끝나고 브라우저로 열지 않음")
    args = ap.parse_args()

    host = urlparse(args.url).netloc.replace(".", "_") or "email"
    out_path = args.out or os.path.join(os.getcwd(), f"{host}-email.html")

    print(f"{cyan('▶')} 추출: {args.url}")
    data = extract(args.url)
    n_text = sum(1 for b in data["blocks"] if b["kind"] == "text")
    n_img = sum(1 for b in data["blocks"] if b["kind"] == "image")
    print(f"  블록 {len(data['blocks'])}개 (텍스트 {n_text} · 이미지 {n_img})")

    if not data["blocks"]:
        sys.exit(red("✗ 추출된 블록 0 — URL/렌더 확인 (JS 페이지면 networkidle 후에도 빈 경우)"))

    html = build_email(data, content_width=args.width)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{green('✓')} 이메일 HTML: {bold(out_path)}")
    print(dim("  → 스티비 [HTML 에디터로 만들기] 에 붙이거나, 그대로 발송"))

    if not args.no_open:
        import subprocess
        subprocess.run(["open", out_path], check=False)


if __name__ == "__main__":
    main()
