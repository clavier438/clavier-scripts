#!/usr/bin/env python3
# brandguide — recon/ 의 _layers.json 멀티태그를 읽어 brandguide_v<NN>.html 생성.
# 있는 레이어만 섹션으로 렌더, 없는 레이어는 건너뜀 (태그 기반 결정, 폴더 존재 검사 아님).
#
#   brandguide.py <recon 폴더>          # 단일 브랜드
#   brandguide.py <recon 폴더> --dry    # HTML 파일 저장 안 하고 stdout 미리보기
#
# 의존: photo-pattern.py (findings 재사용), claude CLI (선택 — 리드 문장 생성)
import glob, json, os, re, shutil, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass

TOOLS = os.path.dirname(os.path.realpath(__file__))
PY = sys.executable


# ── 버전 관리 ──────────────────────────────────────────────────────────────
def next_version(recon_dir, prefix="brandguide_v"):
    mx = 0
    for f in os.listdir(recon_dir):
        m = re.match(rf"^{re.escape(prefix)}(\d+)\.html$", f)
        if m:
            mx = max(mx, int(m.group(1)))
    v = f"{mx+1:02d}"
    return f"v{v}", os.path.join(recon_dir, f"{prefix}{v}.html")


# ── claude CLI (구독 빌링) ──────────────────────────────────────────────────
def run_claude(prompt, model="sonnet"):
    if not shutil.which("claude"):
        return None
    try:
        p = subprocess.run(
            ["claude", "-p", "--system-prompt", "", "--output-format", "json", "--model", model,
             "--disallowed-tools", "Bash Read Write Edit Glob Grep WebFetch WebSearch Task"],
            input=prompt, capture_output=True, text=True, timeout=180)
        if p.returncode != 0:
            return None
        data = json.loads(p.stdout)
        return None if data.get("is_error") else str(data.get("result", "")).strip()
    except Exception:
        return None


# ── 데이터 로더 ────────────────────────────────────────────────────────────
def load_layers(recon_dir):
    """_layers.json 로드. 없으면 recon.py 의 빌더로 즉석 생성 (자족 — 단독 실행 가능)."""
    p = os.path.join(recon_dir, "_layers.json")
    if not os.path.exists(p):
        import importlib.util
        spec = importlib.util.spec_from_file_location("recon", os.path.join(TOOLS, "recon.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        # photos/ 하위 또는 루트(_tags.json 위치) 자동 판별
        photos_dir = os.path.join(recon_dir, "photos")
        if not os.path.isdir(photos_dir) and glob.glob(os.path.join(recon_dir, "*.webp")):
            photos_dir = recon_dir
        layer_tags = mod._build_layer_tags(recon_dir, photos_dir)
        json.dump(layer_tags, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"  (_layers.json 자동 생성)")
        return layer_tags
    return json.load(open(p, encoding="utf-8"))


def load_tags_json(recon_dir):
    p = os.path.join(recon_dir, "photos", "_tags.json")
    if not os.path.exists(p):
        return []
    return json.load(open(p, encoding="utf-8"))


def load_palette(recon_dir):
    """palette.json (신규 recon) → 없으면 _palette/*.json (구 추출) fallback.
    구 추출 실측 구조(이 세션 확인): _palette/<host>.json = [{"css","hex","rgb","count"}, ...].
    신규 recon.py(라인 11)는 colors/*.json 을 palette.json 으로 복사 — 동일 list 포맷."""
    p = os.path.join(recon_dir, "palette.json")
    if not os.path.exists(p):
        legacy = sorted(glob.glob(os.path.join(recon_dir, "_palette", "*.json")))
        if not legacy:
            return []
        p = legacy[0]
    data = json.load(open(p, encoding="utf-8"))
    if isinstance(data, list):
        return data
    return data.get("colors", [])


def load_photo_findings(recon_dir):
    """photo-pattern findings dict (아키타입·룰·문법). photos/ 하위 또는 루트 모두 탐색."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("photo_pattern", os.path.join(TOOLS, "photo-pattern.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for candidate in [os.path.join(recon_dir, "photos"), recon_dir]:
        recs = mod.load(candidate)
        if recs:
            return recs, mod.findings_md(recs)
    return None, None


def load_report_narrative(recon_dir):
    """가장 최근 _report_v<NN>.md 에서 --- 위 서술 부분만 추출."""
    reports = sorted(glob.glob(os.path.join(recon_dir, "_report_v*.md")))
    if not reports:
        return None
    text = open(reports[-1], encoding="utf-8").read()
    body = text.split("---")[0].strip()
    # 헤더 첫 줄 제거
    body = re.sub(r"^#.*\n+>.*\n+", "", body).strip()
    return body if body else None


# ── 리드 생성 (claude CLI) ─────────────────────────────────────────────────
def generate_leads(brand, layers, recs, findings):
    """cover + 각 섹션 1~2줄 리드를 JSON 1회 호출로 전부 받기."""
    available = [k for k, v in layers.items() if v.get("status") == "ready"]
    n_photos = layers.get("photos", {}).get("count", 0)
    palette_hex = []
    recon_dir = None  # caller 가 넘겨줘야 하지만 여기선 findings 에서 추론
    finds_text = findings or "(사진 분류 없음)"
    prompt = (
        f"너는 브랜드 아이덴티티를 분석하는 아트 디렉터다.\n"
        f"브랜드: '{brand}'\n"
        f"분석된 레이어: {', '.join(available)}\n"
        f"사진 수: {n_photos}장\n"
        f"사진 findings:\n{finds_text}\n\n"
        "아래 JSON 형식으로 딱 한 번만 답해라. 추측 금지, findings 수치만 근거. "
        "각 값은 한국어 1~2문장.\n"
        '{"cover": "...", "color": "...", "photo": "...", "type": "...", "icons": "..."}'
    )
    raw = run_claude(prompt)
    if not raw:
        return {}
    try:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else {}
    except Exception:
        return {}


# ── HTML 렌더러 ────────────────────────────────────────────────────────────
CSS = """
*{margin:0;padding:0;box-sizing:border-box}
body{font:15px/1.6 -apple-system,'Helvetica Neue',sans-serif;color:#1a1a1a;background:#fff;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:0 48px}
.cover{padding:120px 48px 80px;border-bottom:1px solid #eee}
.cover .kick{font:600 12px/1 monospace;letter-spacing:.2em;color:#cc3366;text-transform:uppercase}
.cover h1{font-size:64px;font-weight:700;letter-spacing:-.03em;margin:18px 0 10px}
.cover .url{font:13px/1 monospace;color:#999}
.cover .ess{font-size:22px;line-height:1.5;color:#444;max-width:620px;margin:28px 0 0;font-weight:300}
section{padding:72px 0;border-bottom:1px solid #eee}
.sec-h{display:flex;gap:20px;align-items:baseline;margin-bottom:36px}
.sec-n{font:600 12px/1 monospace;color:#cc3366}
.sec-t{font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1a1a1a}
.lead{font-size:20px;line-height:1.55;font-weight:300;color:#333;max-width:660px;margin-bottom:32px}
.sub{font:600 11px/1 monospace;letter-spacing:.12em;text-transform:uppercase;color:#999;margin:30px 0 14px}
.chips{display:flex;gap:14px;flex-wrap:wrap}
.chip{width:130px}
.sw{height:96px;border-radius:6px;border:1px solid rgba(0,0,0,.07)}
.hx{font:11px/1.4 monospace;margin-top:8px;color:#333}
.cl{font-size:11px;color:#999}
.bar{display:flex;align-items:center;gap:12px;margin:7px 0}
.bl{width:64px;font-size:13px;text-align:right;color:#444}
.bt{height:12px;border-radius:3px;display:inline-block;min-width:4px}
.bp{font:11px monospace;color:#999}
.stat{font-size:14px;color:#555;margin:6px 0}
.cluster{margin:34px 0}
.cluster .clab{font:600 11px/1 monospace;letter-spacing:.1em;text-transform:uppercase;color:#1a1a1a;margin-bottom:14px}
.gr{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.gr img{width:100%;height:200px;object-fit:cover;border-radius:5px;background:#f3f3f3}
.hero{width:100%;height:420px;object-fit:cover;border-radius:10px;margin-top:36px}
.type-spec{font-family:'Courier New',monospace;font-size:40px;letter-spacing:-.01em;margin:6px 0}
.type-meta{font:12px/1.6 monospace;color:#888}
.note{font-size:14px;color:#666;background:#faf7f4;border-left:3px solid #d7d4cb;padding:14px 18px;border-radius:0 6px 6px 0;max-width:660px}
.foot{padding:48px;text-align:center;font:11px monospace;color:#bbb}
"""

TONE_COLORS = {
    "웜": "#d9803f", "쿨": "#3f72d9", "뉴트럴": "#9a9a9a", "모노": "#6b6b6b",
    "비비드": "#d94a4a", "어시": "#7e8f43", "뮤트": "#c9a94a", "파스텔": "#9a5fbf",
}

KO_T = {"warm":"웜","cool":"쿨","neutral":"뉴트럴","muted":"뮤트","vivid":"비비드",
        "monochrome":"모노","earthy":"어시","pastel":"파스텔"}
KO_F = {"grain":"그레인","high_contrast":"고대비","faded":"페이드","bw":"흑백",
        "high_key":"하이키","low_key":"로우키","sepia_film":"세피아필름","natural":"내추럴"}
KO_S = {"person":"인물","interior":"실내","exterior":"실외","landscape":"풍경",
        "architecture":"건축","product":"제품","food":"음식","detail":"디테일",
        "still_life":"정물","nonphoto":"비사진"}


def _bar_html(label, pct, color):
    w = round(pct * 2.2, 1)
    return f'<div class="bar"><span class="bl">{label}</span><span class="bt" style="width:{w}px;background:{color}"></span><span class="bp">{pct}%</span></div>'


def render_cover(brand, host, layers, leads, photos_dir):
    hero_img = ""
    webps = sorted(glob.glob(os.path.join(photos_dir, "*.webp"))) if photos_dir else []
    if webps:
        bn = os.path.basename(webps[2] if len(webps) > 2 else webps[0])
        # photos/ 하위면 상대경로 접두, 루트면 파일명만
        src = f"photos/{bn}" if photos_dir and os.path.basename(photos_dir) == "photos" else bn
        hero_img = f'<img class="hero" src="{src}">'
    lead_txt = leads.get("cover", "")
    return f"""
<div class="cover">
  <div class="kick">Visual Standards · 관찰 기반</div>
  <h1>{brand}</h1>
  <div class="url">{host}</div>
  {"" if not lead_txt else f'<p class="ess">{lead_txt}</p>'}
  {hero_img}
</div>"""


def render_color_section(sec_n, layers, leads, palette_colors):
    lead = leads.get("color", "")
    brand_chips = ""
    for c in palette_colors[:7]:
        hex_v = c.get("hex") or c.get("color", "")
        name = c.get("name", "")
        if hex_v:
            brand_chips += f'<div class="chip"><div class="sw" style="background:{hex_v}"></div><div class="hx">{hex_v}</div><div class="cl">{name}</div></div>'

    photo_chips = ""
    # dominant_hex from tags — 상위 7 unique
    seen = set()
    # caller passes recs
    return f"""
<section>
  <div class="sec-h"><span class="sec-n">{sec_n:02d}</span><span class="sec-t">Color</span></div>
  {"" if not lead else f'<p class="lead">{lead}</p>'}
  <div class="sub">Brand · 렌더 컬러</div>
  <div class="chips">{brand_chips or '<span style="color:#999;font-size:13px">추출 없음</span>'}</div>
</section>"""


def render_photo_section(sec_n, layers, leads, recs, photos_dir):
    from collections import Counter
    lead = leads.get("photo", "")

    def ps(r): s = r.get("subject") or []; return s[0] if s else "?"
    def kfin(r): f=[x for x in (r.get("finish") or []) if x!="natural"]; return f[0] if f else "natural"

    n = len(recs)
    tone_ctr = Counter(r.get("tone") for r in recs)
    fin_ctr = Counter(kfin(r) for r in recs)
    subj_ctr = Counter(ps(r) for r in recs)

    tone_bars = "".join(
        _bar_html(KO_T.get(k, k), round(100*v/n), TONE_COLORS.get(KO_T.get(k, k), "#aaa"))
        for k, v in tone_ctr.most_common(8) if k)
    fin_line = "  ·  ".join(f"<b>{KO_F.get(k,k)}</b> {round(100*v/n)}%" for k,v in fin_ctr.most_common(6) if k)
    subj_line = "  ·  ".join(f"<b>{KO_S.get(k,k)}</b> {round(100*v/n)}%" for k,v in subj_ctr.most_common(8) if k)

    # 아키타입 클러스터 — photo-pattern 아키타입별 대표 사진 그리드
    sig = Counter((ps(r), r.get("tone"), r.get("ratio")) for r in recs)
    clusters_html = ""
    used = set()
    for (s, t, rt), c in sig.most_common():
        if c < 3:
            continue
        label = f"— {KO_S.get(s,s)} · {KO_T.get(t,t)} · {rt or '?'}"
        imgs = [r for r in recs if ps(r)==s and r.get("tone")==t and r.get("ratio")==rt][:6]
        if not imgs:
            continue
        # src 경로: photos/ 하위면 photos/ 접두, 루트면 파일명만
        def img_src(r):
            bn = os.path.basename(r["path"])
            d = os.path.dirname(r["path"])
            return f"photos/{bn}" if os.path.basename(d) == "photos" else bn

        grid = "".join(
            f'<img src="{img_src(r)}" loading="lazy">'
            for r in imgs if r.get("path") and os.path.basename(r["path"]) not in used
        )
        for r in imgs:
            if r.get("path"):
                used.add(os.path.basename(r["path"]))
        clusters_html += f'<div class="cluster"><div class="clab">{label}</div><div class="gr">{grid}</div></div>'
        if len(used) > 24:
            break

    return f"""
<section>
  <div class="sec-h"><span class="sec-n">{sec_n:02d}</span><span class="sec-t">Photography · Art Direction</span></div>
  {"" if not lead else f'<p class="lead">{lead}</p>'}
  <div class="sub">톤 분포</div>{tone_bars}
  <div class="sub">후보정</div><p class="stat">{fin_line}</p>
  <div class="sub">피사체</div><p class="stat">{subj_line}</p>
  {clusters_html}
</section>"""


def render_type_section(sec_n, families, leads):
    lead = leads.get("type", "")
    spec = families[0] if families else "—"
    meta = " · ".join(families)
    return f"""
<section>
  <div class="sec-h"><span class="sec-n">{sec_n:02d}</span><span class="sec-t">Typography</span></div>
  {"" if not lead else f'<p class="lead">{lead}</p>'}
  <div class="type-spec">Aa Bb Cc Dd 0123456789</div>
  <div class="type-meta">{meta}</div>
</section>"""


def render_icons_section(sec_n, icon_layer, leads):
    lead = leads.get("icons", "")
    libs = icon_layer.get("libs") or []
    has_svg = icon_layer.get("svg", False)
    if libs:
        note_text = f"아이콘 라이브러리: <b>{', '.join(libs)}</b>. " + (
            "자체 SVG 에셋 포함." if has_svg else "독립 SVG 에셋 없음.")
    else:
        note_text = "아이콘 라이브러리 미감지. 인라인 SVG 또는 직접 구현 방식일 수 있음."
    return f"""
<section>
  <div class="sec-h"><span class="sec-n">{sec_n:02d}</span><span class="sec-t">Assets · Iconography</span></div>
  {"" if not lead else f'<p class="lead">{lead}</p>'}
  <p class="note">{note_text}</p>
</section>"""


# ── 메인 생성기 ────────────────────────────────────────────────────────────
def generate(recon_dir, dry=False, model="sonnet"):
    recon_dir = os.path.abspath(os.path.expanduser(recon_dir))
    brand = os.path.basename(os.path.dirname(recon_dir.rstrip("/")))  # books/<host>/recon → host
    # fallback: recon_dir 자체가 브랜드 폴더일 때
    if brand in ("recon", ""):
        brand = os.path.basename(recon_dir.rstrip("/"))
    host = brand

    layers = load_layers(recon_dir)
    recs, findings = load_photo_findings(recon_dir)
    palette_colors = load_palette(recon_dir)

    print(f"  레이어 태그: { {k: v['status'] for k,v in layers.items()} }")
    print(f"  리드 생성 중 (claude CLI)…")
    leads = generate_leads(brand, layers, recs, findings) if recs or palette_colors else {}

    photos_dir = os.path.join(recon_dir, "photos") if layers["photos"]["status"] in ("ready","tagged","untagged") else None

    # photos_dir: _tags.json 이 실제로 있는 폴더 (photos/ 또는 루트)
    if recs:
        for candidate in [os.path.join(recon_dir, "photos"), recon_dir]:
            if os.path.exists(os.path.join(candidate, "_tags.json")):
                photos_dir = candidate
                break

    # 섹션 빌드 — 태그 status 로 포함 여부 결정
    sections = []
    sec_n = 1

    if layers["palette"]["status"] == "ready":
        sections.append(render_color_section(sec_n, layers, leads, palette_colors))
        sec_n += 1

    if layers["photos"]["status"] in ("tagged",) and recs:
        sections.append(render_photo_section(sec_n, layers, leads, recs, photos_dir))
        sec_n += 1

    if layers["fonts"]["status"] == "ready":
        sections.append(render_type_section(sec_n, layers["fonts"].get("families", []), leads))
        sec_n += 1

    if layers["icons"]["status"] == "ready":
        sections.append(render_icons_section(sec_n, layers["icons"], leads))
        sec_n += 1

    cover = render_cover(brand, host, layers, leads, photos_dir)
    n_total = layers["photos"]["count"]
    footer = f'<div class="foot">auto-generated visual standards · brandguide.py + recon · {n_total} photos · layers: { " ".join(t for v in layers.values() for t in v.get("tags",[])) }</div>'

    html = f"""<!doctype html><html lang=ko><head><meta charset=utf-8>
<style>
{CSS}
</style></head><body>
{cover}
<div class="wrap">
{"".join(sections)}
</div>
{footer}
</body></html>"""

    if dry:
        print(html[:2000])
        print(f"\n  … (총 {len(html)} chars) — dry 모드, 저장 안 함")
        return

    ver, out_path = next_version(recon_dir)
    open(out_path, "w", encoding="utf-8").write(html)
    print(f"  ✓ {os.path.basename(out_path)} 생성 ({len(sections)} 섹션, {len(html)//1024}KB)")
    return out_path


if __name__ == "__main__":
    args = sys.argv[1:]
    dry = "--dry" in args
    args = [a for a in args if a != "--dry"]
    if not args:
        print("usage: brandguide.py <recon 폴더> [--dry]")
        sys.exit(1)
    generate(args[0], dry=dry)
