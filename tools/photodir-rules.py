#!/usr/bin/env python3
# photodir-rules — 코어→변주 보고서. 청크 = AI(사람/지능)가 박은 *측정 가능·확실한 법칙*.
#
#   역할 분리(사용자 확정): 스크립트는 (1)규칙 적용 (2)그레이드 측정 (3)예시 추출 만 한다.
#   청크를 무엇으로 가를지(법칙)는 지능의 판단 — 여기 CHUNKS 에 박는다. semantic CLIP·argmax 격자·
#   손라벨 없음. 법칙은 전부 픽셀에서 측정되는 무해석 값(채도·휘도·그림자비율·섀도색·붉은비율).
#   흰 프레임(인스타 레이아웃)은 측정 오염원이라 제외(photo-montage.is_framed 재사용).
#
#   구조: ■코어(전체 측정 베이스) → ■변주(각 법칙 청크: 측정 Δ + 그 법칙에 맞는 실제 예시).
#         "엄밀함보다 확실한 법칙만 과감하게"(사용자). 안 맞는 사진은 코어에 남김(강제배정 안 함).
#
#   사용:  photodir-rules.py <work> <폴더> [--per 20]
import os, sys, json, base64, io, glob, importlib.util, argparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경도 동작)
except ImportError:
    pass
from image_formats import PHOTO_EXTS, register_heif
from PIL import Image
register_heif()
TOOLS = os.path.dirname(os.path.realpath(__file__))


def _mod(name, fn):
    spec = importlib.util.spec_from_file_location(name, os.path.join(TOOLS, fn))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


pl = _mod("photolut", "photo-lut.py")
mont = _mod("photomont", "photo-montage.py")
ZONES = ("shadow", "mid", "high")


def feat(path):
    """한 번 디코딩으로 그레이드 서명 + 규칙 피처. 흰프레임은 호출 전 제외 가정."""
    try:
        im = Image.open(path).convert("RGB"); im.thumbnail((180, 180))
    except Exception:
        return None
    acc = {z: [0.0, 0.0, 0.0, 0] for z in ZONES}
    n = 0; satsum = 0.0; strongred = 0; Ls = []
    for r, g, b in im.getdata():
        L, A, B = pl.rgb_to_lab(r / 255, g / 255, b / 255)
        z = "shadow" if L < 33 else "high" if L > 66 else "mid"
        a = acc[z]; a[0] += L; a[1] += A; a[2] += B; a[3] += 1
        n += 1; Ls.append(L)
        mx = max(r, g, b); mn = min(r, g, b)
        satsum += (mx - mn) / mx if mx else 0
        if A > 33:                     # *강한 채도* 레드/마젠타 = 네온·무대 점광 (웜 음식 A~15-25 와 분리)
            strongred += 1
    if not n:
        return None
    sig = {z: (acc[z][0] / acc[z][3], acc[z][1] / acc[z][3], acc[z][2] / acc[z][3]) if acc[z][3] else None for z in ZONES}
    sh = acc["shadow"]
    # 선명도(고주파) — 전체 + 중앙/주변 분리. 포어그라운드 블러 = 중앙 샤프 + 주변 소프트.
    gg = im.convert("L").resize((96, 96)); gp = list(gg.getdata()); W = 96
    lacc = lc = cacc = cc = eacc = ec = 0
    for y in range(1, 95):
        base = y * W; cy = 26 <= y < 70
        for x in range(1, 95):
            c = gp[base + x]
            lap = 4 * c - gp[base + x - 1] - gp[base + x + 1] - gp[base - W + x] - gp[base + W + x]
            e = lap * lap; lacc += e; lc += 1
            if cy and 26 <= x < 70:
                cacc += e; cc += 1
            elif y < 13 or y > 82 or x < 13 or x > 82:
                eacc += e; ec += 1
    sharp = (lacc / lc) ** 0.5 / 255.0 if lc else 0.0
    cen_sharp = (cacc / cc) ** 0.5 / 255.0 if cc else 0.0
    edge_sharp = (eacc / ec) ** 0.5 / 255.0 if ec else 0.0
    # 지배색 (양자화 6색) — 코퍼스 색 팔레트 집계용
    doms = []
    try:
        q = im.quantize(6); palt = q.getpalette()
        tot_px = im.size[0] * im.size[1]
        for cnt, idx in sorted(q.getcolors(), reverse=True)[:6]:
            doms.append(((palt[idx * 3], palt[idx * 3 + 1], palt[idx * 3 + 2]), cnt / tot_px))
    except Exception:
        pass
    meanL = sum(Ls) / n
    rule = {"sat": satsum / n, "meanL": meanL,
            "shadow_frac": sum(1 for x in Ls if x < 33) / n,
            "high_frac": sum(1 for x in Ls if x > 66) / n,    # 밝은 빛이 쏟아지는 영역
            "contrast": (sum((x - meanL) ** 2 for x in Ls) / n) ** 0.5,  # 빛-어둠 대비(드라마)
            "shadow_b": (sh[2] / sh[3]) if sh[3] else 0.0,
            "red_strong": strongred / n,
            "sharp": sharp, "cen_sharp": cen_sharp,
            "fg_blur": (cen_sharp / edge_sharp) if edge_sharp > 0.001 else 1.0}
    return sig, rule, doms


# ── 기법 태그 (비배타: 한 사진이 여러 기법 가질 수 있음. 동등한 그룹 아님). 측정 가능·무해석. ──
TECHNIQUES = [
    ("light",  "성스러운 빛 — 강한 광원이 부드럽게 쏟아짐 (공간·퍼실리티)",
     "밝은 빛영역 큼 (하이존>22% & 섀도<40%)",
     lambda f: f["high_frac"] > 0.22 and f["shadow_frac"] < 0.40),
    ("drama",  "드라마틱 하이라이트 — 빛 한 줄기 + 깊은 어둠",
     "고대비 (대비>34)",
     lambda f: f["contrast"] > 34),
    ("deepsh", "깊은 그림자 — 저조도 키아로스쿠로",
     "그림자 우세 (섀도>58%)",
     lambda f: f["shadow_frac"] > 0.58),
    ("fgblur", "몽환 베일 — 흐린 전경 너머의 찰나 (선택적 포어그라운드 블러 + 강한 후보정)",
     "중앙 샤프 + 주변 소프트 (비율>1.9 & 중앙선명>0.09)",
     lambda f: f["fg_blur"] > 1.9 and f["cen_sharp"] > 0.09),
    ("soft",   "스모키·블러·잔상 — 전체 소프트/모션/헤이즈",
     "전체 선명도 낮음 (sharp<0.085)",
     lambda f: f["sharp"] < 0.085),
    ("mono",   "모노크롬 — 흑백·탈채",
     "채도<0.07",
     lambda f: f["sat"] < 0.07),
    ("red",    "붉은 불빛 — 재즈·캔들·불",
     "강채도 레드/마젠타 (강레드>2%)",
     lambda f: f["red_strong"] > 0.02),
    ("teal",   "틸·네이비 쿨 — 스파·물·밤하늘",
     "섀도 쿨/틸 (shadow b<-3)",
     lambda f: f["shadow_b"] < -3.0),
]


def route(sig):
    def zw(nm, s):
        if not s:
            return f"{nm}—"
        warm = "웜" if s[2] > 3 else "쿨/틸" if s[2] < -2 else "중"
        return f"{nm} L{s[0]:.0f}·b{s[2]:+.0f}({warm})"
    return " · ".join(zw(n, sig.get(z)) for z, n in (("shadow", "섀도"), ("mid", "미드"), ("high", "하이")))


def delta(sig, base):
    out = []
    for zk, zn in (("shadow", "섀도"), ("mid", "미드"), ("high", "하이")):
        s, b = sig.get(zk), base.get(zk)
        if not (s and b):
            continue
        db, dl = s[2] - b[2], s[0] - b[0]
        if abs(db) < 2 and abs(dl) < 5:
            continue
        t = ("웜" if db > 2 else "틸/쿨" if db < -2 else "") + ("·밝" if dl > 5 else "·어둡" if dl < -5 else "")
        out.append(f"{zn} {t}(Δb{db:+.0f} ΔL{dl:+.0f})")
    return " · ".join(out) or "≈코어"


def avg(sigs):
    sigs = [s for s in sigs if s]
    return pl.average_signatures(sigs) if sigs else {}


def b64(path, edge=150, q=74):
    im = Image.open(path).convert("RGB"); im.thumbnail((edge, edge))
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=q)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("folder"); ap.add_argument("--per", type=int, default=20)
    a = ap.parse_args()
    imgs = sorted(p for p in glob.glob(os.path.join(os.path.expanduser(a.folder), "**", "*"), recursive=True)
                  if os.path.splitext(p)[1].lower() in PHOTO_EXTS and not os.path.basename(p).startswith("."))
    print(f"{len(imgs)}장 — 흰프레임 제외 + 피처·색 측정…")
    rows = []                      # (path, sig, rule, doms)
    framed = 0
    for i, p in enumerate(imgs):
        if mont.is_framed(p):
            framed += 1; continue
        r = feat(p)
        if r:
            rows.append((p, r[0], r[1], r[2]))
        if (i + 1) % 300 == 0:
            print(f"  …{i+1}/{len(imgs)}")
    print(f"  → {len(rows)}장 (흰프레임 {framed} 제외)")
    base_sig = avg([s for _, s, _, _ in rows])     # 베이스 = 전체 측정 (공통 바닥)

    # ── 색 팔레트 (코퍼스 전체 지배색 집계) ──
    hist = {}
    for _, _, _, doms in rows:
        for (cr, cg, cb), frac in doms:
            k = (cr // 24, cg // 24, cb // 24)
            hist[k] = hist.get(k, 0.0) + frac
    tot = sum(hist.values()) or 1
    swatches = [((k[0] * 24 + 12, k[1] * 24 + 12, k[2] * 24 + 12), v / tot)
                for k, v in sorted(hist.items(), key=lambda kv: -kv[1])]
    primary = swatches[:12]
    def sat_of(c):
        mx, mn = max(c), min(c); return (mx - mn) / mx if mx else 0
    accent = [s for s in swatches if sat_of(s[0]) > 0.32 and s[1] > 0.0015][:10]

    # ── 비배타 기법 태그 (한 사진이 여러 기법 가질 수 있음) ──
    assigned = {t[0]: [] for t in TECHNIQUES}
    for p, sig, ru, _ in rows:
        for cid, _, _, pred in TECHNIQUES:
            if pred(ru):
                assigned[cid].append((p, sig, ru))

    def sample(items, per):
        if len(items) <= per:
            return items
        step = len(items) / per
        return [items[int(i * step)] for i in range(per)]

    def sw(c, frac):
        return (f'<div class="sw" title="{frac*100:.1f}%"><span style="background:rgb({c[0]},{c[1]},{c[2]})">'
                f'</span><small>{frac*100:.1f}</small></div>')

    H = [_HEAD]
    H.append('<div class="core"><h2>■ 베이스 (전체에 깔리는 측정 기준)</h2>'
             f'<p class="n">{len(rows)}장 전체</p>'
             '<p class="shoot">촬영: 단방향 광원 · 한 주인공 · 황금빛~저녁 텅스텐. 좁은 코어팔레트(흑/우드/청동/딥그린) + 풍부한 보조색.</p>'
             f'<p class="route">후보정 베이스: {route(base_sig)}</p></div>')
    H.append('<div class="palbox"><h2>■ 사진 디렉션 컬러 팔레트 (코퍼스 측정)</h2>'
             '<p class="rule">주색 — 빈도순 (숫자=전체 비중%)</p><div class="pal">'
             + "".join(sw(c, f) for c, f in primary) + '</div>'
             '<p class="rule" style="margin-top:.7em">액센트 — 채도 높은 비주류 색 (딥그린·레드·틸/네이비 등)</p><div class="pal">'
             + "".join(sw(c, f) for c, f in accent) + '</div></div>')
    H.append('<h2>■ 기법 (비배타 — 한 사진이 여러 기법 가질 수 있음 · 크기순)</h2>')
    for cid, ko, rule_txt, _ in sorted(TECHNIQUES, key=lambda c: -len(assigned[c[0]])):
        grp = assigned[cid]
        if not grp:
            continue
        g_sig = avg([s for _, s, _ in grp])
        H.append(f'<div class="var"><h3>{ko} <span class="n">{len(grp)}장</span></h3>'
                 f'<p class="rule">법칙: {rule_txt}</p>'
                 f'<p class="route">Δ베이스: {delta(g_sig, base_sig)}</p>'
                 '<div class="gal">' + "".join(f'<img src="{b64(p)}">' for p, _, _ in sample(grp, a.per)) + '</div></div>')
    H.append("</div></body></html>")
    out = os.path.join(os.path.expanduser(a.work), "direction.html")
    open(out, "w", encoding="utf-8").write("\n".join(H))
    print(f"✓ → {out}")
    print("기법(비배타):", {t[1].split(' ')[0]: len(assigned[t[0]]) for t in TECHNIQUES})


_HEAD = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AMAN NY — 코어→변주</title>
<style>
:root{--bg:#0d0d0f;--fg:#e8e4dc;--dim:#9a948a;--amber:#c89b5a;--line:#2a2823}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"Apple SD Gothic Neo",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:32px 20px 100px}
h2{font-size:20px;border-bottom:1px solid var(--line);padding-bottom:.3em;margin-top:1.6em}
h3{font-size:16px;margin:.2em 0;color:var(--amber)}
.n{color:var(--dim);font-size:12px;font-weight:400}
.core{background:#15140f;border:1px solid var(--amber);border-radius:8px;padding:.5em 1.2em;margin:1em 0}
.core h2{border:none;color:var(--amber);margin-top:.3em}
.shoot{color:var(--fg);font-size:13px}.rule{color:var(--dim);font-size:12px}
.route{color:var(--amber);font-size:11.5px;font-family:ui-monospace,monospace}
.var{border:1px solid var(--line);border-radius:8px;padding:.5em 1em;margin:.8em 0;background:#111}
.gal{display:flex;flex-wrap:wrap;gap:3px;margin-top:.5em}
.gal img{width:160px;height:160px;object-fit:cover;border-radius:3px}
.palbox{background:#15140f;border:1px solid var(--line);border-radius:8px;padding:.5em 1.2em;margin:1em 0}
.palbox h2{border:none;margin-top:.3em}
.pal{display:flex;flex-wrap:wrap;gap:4px;margin-top:.3em}
.sw{display:flex;flex-direction:column;align-items:center}
.sw span{width:62px;height:62px;border-radius:4px;display:block;border:1px solid #0006}
.sw small{color:var(--dim);font-size:10px;margin-top:2px}
</style></head><body><div class="wrap"><h1>AMAN NEW YORK</h1>"""


if __name__ == "__main__":
    main()
