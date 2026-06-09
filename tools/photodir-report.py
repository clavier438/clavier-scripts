#!/usr/bin/env python3
# photodir-report — 역설계 산출물(_concepts·_subjects·_lut_tree·brief)을 인터랙티브 HTML 도면 한 장으로.
#
#   상단 = One-Page 사진가 브리프(의도/지배원칙/맥락 + 컨셉별 미니브리프) = 창작면.
#   하단 = 증거 트리: core→concept→sub LUT(잔차 수치) + before/after 렌더 + 피사체 교차표 + 샘플 갤러리.
#   "어떻게 디렉션하나"(브리프)와 "어떻게 만들어졌나"(증거)를 한 페이지 양면으로.
#
#   before/after = 컨셉 절대 .cube 를 대표 1장에 trilinear 적용(로컬, claude 0).
#
#   사용:  photodir-report.py <work 디렉토리> [--brand "Aman New York"]
#   입력(있으면 렌더): _concepts.json · _subjects.json · _lut_tree.json · brief.json · concept_samples/
import os, sys, glob, json, argparse, base64, io
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass
from image_formats import register_heif
from PIL import Image
register_heif()


# ── .cube 파서 + trilinear 적용 (before/after 렌더) ──────────────────────────
def load_cube(path):
    size, table = None, []
    for ln in open(path):
        s = ln.strip()
        if not s or s.startswith(("#", "TITLE", "DOMAIN")):
            continue
        if s.startswith("LUT_3D_SIZE"):
            size = int(s.split()[-1]); continue
        p = s.split()
        if len(p) == 3:
            try:
                table.append(tuple(float(x) for x in p))
            except ValueError:
                pass
    return size, table


def apply_cube(im, cube, amount=1.0):
    """trilinear 3D LUT 적용. cube=(size, table[r fastest]). amount=blend(0~1)."""
    size, table = cube
    if not size or len(table) != size ** 3:
        return im
    im = im.convert("RGB"); px = im.load(); w, h = im.size
    N = size - 1

    def lookup(r, g, b):
        rf, gf, bf = r * N, g * N, b * N
        r0, g0, b0 = int(rf), int(gf), int(bf)
        r1, g1, b1 = min(r0 + 1, N), min(g0 + 1, N), min(b0 + 1, N)
        dr, dg, db = rf - r0, gf - g0, bf - b0
        def idx(ri, gi, bi): return ri + gi * size + bi * size * size
        c000 = table[idx(r0, g0, b0)]; c100 = table[idx(r1, g0, b0)]
        c010 = table[idx(r0, g1, b0)]; c110 = table[idx(r1, g1, b0)]
        c001 = table[idx(r0, g0, b1)]; c101 = table[idx(r1, g0, b1)]
        c011 = table[idx(r0, g1, b1)]; c111 = table[idx(r1, g1, b1)]
        out = []
        for k in range(3):
            x00 = c000[k] * (1 - dr) + c100[k] * dr
            x10 = c010[k] * (1 - dr) + c110[k] * dr
            x01 = c001[k] * (1 - dr) + c101[k] * dr
            x11 = c011[k] * (1 - dr) + c111[k] * dr
            y0 = x00 * (1 - dg) + x10 * dg
            y1 = x01 * (1 - dg) + x11 * dg
            out.append(y0 * (1 - db) + y1 * db)
        return out

    out = Image.new("RGB", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            nr, ng, nb = lookup(r / 255, g / 255, b / 255)
            if amount < 1.0:
                nr = (r / 255) * (1 - amount) + nr * amount
                ng = (g / 255) * (1 - amount) + ng * amount
                nb = (b / 255) * (1 - amount) + nb * amount
            op[x, y] = (max(0, min(255, int(nr * 255))),
                        max(0, min(255, int(ng * 255))),
                        max(0, min(255, int(nb * 255))))
    return out


def b64(im, max_edge=520, q=82):
    im = im.copy(); im.thumbnail((max_edge, max_edge))
    buf = io.BytesIO(); im.convert("RGB").save(buf, "JPEG", quality=q)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _load(path):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else None


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def main():
    ap = argparse.ArgumentParser(description="역설계 산출물 → 인터랙티브 HTML 도면")
    ap.add_argument("work", help="work 디렉토리 (_concepts/_subjects/_lut_tree/brief.json)")
    ap.add_argument("--brand", default=None)
    ap.add_argument("--render-edge", type=int, default=460, help="before/after 렌더 long-edge")
    a = ap.parse_args()
    work = os.path.abspath(os.path.expanduser(a.work))
    treatments_man = _load(os.path.join(work, "_treatments.json"))
    subjects = _load(os.path.join(work, "_subjects.json"))
    tree = _load(os.path.join(work, "_lut_tree.json"))
    brief = _load(os.path.join(work, "brief.json"))
    brand = a.brand or (brief or {}).get("brand") or os.path.basename(os.path.dirname(work))

    subj_of = {r["file"]: r.get("subjects", []) for r in (subjects or [])}

    # treatment 노드: lut_tree(base 잔차) + _treatments(샘플) + brief(미니) 를 id 로 머지
    lut_by_id = {t["id"]: t for t in (tree or {}).get("treatments", [])}
    samp_by_id = {g["id"]: g for g in (treatments_man or {}).get("groups", [])}
    brief_t = {c["id"]: c for c in (brief or {}).get("concepts", [])}
    order = [t["id"] for t in (tree or {}).get("treatments", [])] or list(samp_by_id)
    base = (tree or {}).get("base")

    html = [_HEAD.replace("{{BRAND}}", esc(brand))]
    if brief:
        html.append(_render_brief(brief))
    html.append('<section class="evidence"><h2>증거 — treatment 트리 (어떻게 찍고·후보정)</h2>')
    if base:
        html.append(f'<div class="core"><h3>BASE — 브랜드 공통 후보정 (이 위에 각 treatment 가 얹힘)</h3>'
                    f'<pre>{esc(base.get("describe",""))}</pre>'
                    f'<p class="ev">3패널 = 추정 무보정(역LUT) → +BASE → +treatment(≈원본)</p></div>')
    for tid in order:
        html.append(_render_treatment(work, tid, samp_by_id.get(tid), lut_by_id.get(tid),
                                      brief_t.get(tid), subj_of, base, a.render_edge))
    html.append('</section>')
    html.append(_FOOT)

    out = os.path.join(work, "photodirection.html")
    open(out, "w", encoding="utf-8").write("\n".join(html))
    print(f"✓ → {out}")


def _render_brief(b):
    h = ['<section class="brief">']
    h.append(f'<div class="badge">재현용 가설 브리프 · 역추적</div>')
    intent = b.get("intent", {})
    h.append(f'<h1>{esc(b.get("brand",""))}</h1>')
    if b.get("tagline"):
        h.append(f'<p class="tagline">{esc(b["tagline"])}</p>')
    h.append('<div class="part"><h2>1 · 의도 <span>Intent</span></h2>')
    if intent.get("title"):
        h.append(f'<h3>{esc(intent["title"])}</h3>')
    for para in (intent.get("body", "").split("\n\n") if intent.get("body") else []):
        h.append(f'<p>{esc(para)}</p>')
    if intent.get("one_line"):
        h.append(f'<blockquote>{esc(intent["one_line"])}</blockquote>')
    if intent.get("sources"):
        h.append('<p class="src">근거: ' + " · ".join(
            f'<a href="{esc(s)}">{esc(s.split("//")[-1].split("/")[0])}</a>' for s in intent["sources"]) + '</p>')
    h.append('</div>')
    h.append('<div class="part"><h2>2 · 지배적 원칙 <span>Dominant Rules</span></h2>')
    for r in b.get("rules", []):
        h.append(f'<div class="rule"><b>{esc(r.get("id",""))}. {esc(r.get("title",""))}</b>'
                 f'<p>{esc(r.get("body",""))}</p>')
        if r.get("exception"):
            h.append(f'<p class="exc">예외: {esc(r["exception"])}</p>')
        if r.get("evidence"):
            h.append(f'<p class="ev">근거: {esc(r["evidence"])}</p>')
        h.append('</div>')
    h.append('</div>')
    ctx = b.get("context", {})
    h.append('<div class="part"><h2>3 · 맥락 <span>Context · 디렉터 가설</span></h2>')
    if ctx.get("gaze"):
        h.append(f'<p>{esc(ctx["gaze"])}</p>')
    for c in ctx.get("cuts", []):
        h.append(f'<div class="cut"><b>{esc(c.get("name",""))}</b>'
                 f'<p>{esc(c.get("body",""))}</p></div>')
    if ctx.get("questions"):
        h.append('<div class="q"><b>사진가께 — 협의 채널</b><ul>'
                 + "".join(f'<li>{esc(q)}</li>' for q in ctx["questions"]) + '</ul></div>')
    h.append('</div></section>')
    return "\n".join(h)


def _render_treatment(work, tid, samp, lut, briefc, subj_of, base, edge):
    ko = (briefc or {}).get("ko") or (lut or {}).get("ko") or (samp or {}).get("describe") or tid
    n = (samp or {}).get("size") or (lut or {}).get("n") or 0
    desc = (lut or {}).get("describe", "") or (samp or {}).get("describe", "")
    h = [f'<details class="cnode" open><summary><b>{esc(tid)} · {esc(ko)}</b> '
         f'<span class="n">{n}장</span></summary>']
    if desc:
        h.append(f'<pre class="tdesc">{esc(desc)}</pre>')
    # 잔차 (delta from base) + nested
    if lut and lut.get("delta_from_base"):
        h.append('<div class="delta">Δbase: ' + " · ".join(esc(d) for d in lut["delta_from_base"]) + '</div>')
        for sub in lut.get("subs", []):
            h.append(f'<div class="sub">└ {esc(sub["id"])} ({sub["n"]}장) Δ: '
                     + " · ".join(esc(d) for d in sub.get("delta_from_treatment", [])) + '</div>')
    # 미니 브리프
    if briefc and briefc.get("mini"):
        m = briefc["mini"]
        h.append('<div class="mini"><b>미니브리프 — 어떻게 찍고·후보정</b>')
        if m.get("shoot"): h.append(f'<p>촬영: {esc(m["shoot"])}</p>')
        if m.get("grade"): h.append(f'<p>그레이드: {esc(m["grade"])}</p>')
        if m.get("use"): h.append(f'<p><i>주 사용처: {esc(m["use"])}</i></p>')
        h.append('</div>')
    # 3패널 before/after: 추정무보정(역LUT) → +BASE → +treatment(≈원본)
    sd = (samp or {}).get("dir"); samples = (samp or {}).get("samples", [])
    if sd and samples and lut:
        first = os.path.join(work, sd, samples[0])
        inv = os.path.join(work, lut.get("inverse_cube", ""))
        basef = os.path.join(work, (base or {}).get("cube", ""))
        fwd = os.path.join(work, lut.get("cube", ""))
        if os.path.exists(first) and os.path.exists(inv):
            try:
                im = Image.open(first); im.thumbnail((edge, edge))
                neutral = apply_cube(im, load_cube(inv))                 # 그레이드 제거 = 추정 무보정
                panels = [(b64(neutral, edge), "추정 무보정 (역LUT)")]
                if os.path.exists(basef):
                    panels.append((b64(apply_cube(neutral, load_cube(basef)), edge), "+ BASE"))
                if os.path.exists(fwd):
                    panels.append((b64(apply_cube(neutral, load_cube(fwd)), edge), "+ treatment (≈원본)"))
                h.append('<div class="ba">' + "".join(
                    f'<figure><img src="{src}"><figcaption>{cap}</figcaption></figure>' for src, cap in panels)
                    + '</div>')
            except Exception:
                pass
    # 피사체 교차표 (보조 — 이 treatment 가 어떤 피사체에 걸치나)
    from collections import Counter
    c = Counter(s for f in samples for s in subj_of.get(f, []))
    if c:
        tot = max(1, len(samples))
        h.append('<div class="xtab">걸친 피사체: ' + " · ".join(
            f'{esc(k)} {round(100*v/tot)}%' for k, v in c.most_common(6)) + '</div>')
    # 샘플 갤러리 (다양성 추출 50)
    if sd and samples:
        h.append('<div class="gal">')
        for fn in samples:
            fp = os.path.join(work, sd, fn)
            if os.path.exists(fp):
                try:
                    h.append(f'<img loading="lazy" src="{b64(Image.open(fp), 150, 70)}">')
                except Exception:
                    pass
        h.append('</div>')
    h.append('</details>')
    return "\n".join(h)


_HEAD = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{BRAND}} — 포토 아트디렉션 역설계</title>
<style>
:root{--bg:#0d0d0f;--fg:#e8e4dc;--dim:#9a948a;--amber:#c89b5a;--line:#2a2823}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
font:15px/1.7 -apple-system,"Helvetica Neue","Apple SD Gothic Neo",sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:48px 24px 120px}
h1{font-size:38px;letter-spacing:-.02em;margin:.2em 0}
h2{font-size:22px;border-bottom:1px solid var(--line);padding-bottom:.3em;margin-top:2em}
h2 span{color:var(--dim);font-size:14px;font-weight:400;margin-left:.5em}
h3{color:var(--amber);font-size:18px}
.tagline{color:var(--dim);font-size:18px;font-style:italic}
.badge{display:inline-block;border:1px solid var(--amber);color:var(--amber);
font-size:12px;padding:3px 10px;border-radius:3px;letter-spacing:.04em}
blockquote{border-left:3px solid var(--amber);margin:1em 0;padding:.4em 1em;color:var(--amber);font-size:17px}
.rule{margin:1.1em 0}.rule b{color:var(--fg)}.exc{color:var(--dim);font-size:14px;border-left:2px solid var(--line);padding-left:.8em}
.ev{color:#7fae7f;font-size:13px}.src{color:var(--dim);font-size:13px}.src a{color:var(--dim)}
.cut{margin:.8em 0}.cut b{color:var(--amber)}
.q{background:#15140f;border:1px solid var(--line);border-radius:6px;padding:.6em 1.2em;margin-top:1.5em}
.evidence{margin-top:3em}.core pre{background:#15140f;padding:1em;border-radius:6px;color:var(--amber);font-size:13px;overflow:auto}
.cnode{border:1px solid var(--line);border-radius:8px;margin:14px 0;padding:8px 16px;background:#111}
.cnode summary{cursor:pointer;font-size:18px}.cnode .n{color:var(--dim);font-size:13px}
.tdesc{background:#15140f;color:var(--dim);font-size:12px;padding:.4em .8em;border-radius:5px;margin:.3em 0}
.delta{color:var(--amber);font-size:13px;font-family:monospace;margin:.5em 0}
.sub{color:var(--dim);font-size:12px;font-family:monospace;margin-left:1em}
.mini{background:#15140f;border-radius:6px;padding:.5em 1em;margin:.7em 0;font-size:14px}
.mini i{color:var(--amber)}
.ba{display:flex;gap:10px;margin:.8em 0}.ba figure{margin:0;flex:1}.ba img{width:100%;border-radius:4px}
.ba figcaption{color:var(--dim);font-size:12px;text-align:center}
.xtab{color:var(--dim);font-size:13px;margin:.5em 0}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:4px;margin-top:.6em}
.gal img{width:100%;height:92px;object-fit:cover;border-radius:3px}
</style></head><body><div class="wrap">"""
_FOOT = """</div></body></html>"""


if __name__ == "__main__":
    main()
