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
    rule = {"sat": satsum / n, "meanL": sum(Ls) / n,
            "shadow_frac": sum(1 for x in Ls if x < 33) / n,
            "shadow_b": (sh[2] / sh[3]) if sh[3] else 0.0,
            "red_strong": strongred / n}
    return sig, rule


# ── 청크 법칙 (AI 판단, 우선순위 순). predicate(rule)->bool. 확실한 것만, 과감하게. ──
CHUNKS = [
    ("mono",   "모노크롬 — 흑백·탈채", "채도 < 0.07",
     lambda f: f["sat"] < 0.07),
    ("red",    "붉은 불빛의 밤 — 재즈·캔들·불", "강채도 레드/마젠타 + 어두움 (강레드>2% & 섀도>45%)",
     lambda f: f["red_strong"] > 0.02 and f["shadow_frac"] > 0.45),
    ("bright", "주광 — 코어를 깸 (예외)", "밝고 그림자 적음 (평균L>54 & 섀도<28%)",
     lambda f: f["meanL"] > 54 and f["shadow_frac"] < 0.28),
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
    print(f"{len(imgs)}장 — 흰프레임 제외 + 피처 측정…")
    rows = []                      # (path, sig, rule)
    framed = 0
    for i, p in enumerate(imgs):
        if mont.is_framed(p):
            framed += 1; continue
        r = feat(p)
        if r:
            rows.append((p, r[0], r[1]))
        if (i + 1) % 300 == 0:
            print(f"  …{i+1}/{len(imgs)}")
    print(f"  → {len(rows)}장 (흰프레임 {framed} 제외)")

    # 규칙 우선순위로 청크 배정 (안 맞으면 core 에 남음)
    assigned = {c[0]: [] for c in CHUNKS}
    core = []
    for p, sig, ru in rows:
        for cid, _, _, pred in CHUNKS:
            if pred(ru):
                assigned[cid].append((p, sig, ru)); break
        else:
            core.append((p, sig, ru))
    base_sig = avg([s for _, s, _ in core])    # 코어 = 변주에 안 걸린 다수 = 진짜 베이스

    def sample(items, per):
        if len(items) <= per:
            return items
        step = len(items) / per
        return [items[int(i * step)] for i in range(per)]

    H = [_HEAD]
    H.append('<div class="core"><h2>■ 코어 (전체의 다수 · 측정 베이스)</h2>'
             f'<p class="n">{len(core)}장 — 변주 법칙에 안 걸린 나머지 = 브랜드 기본</p>'
             '<p class="shoot">촬영: 단방향 광원 · 그림자 30~50% · 한 주인공 · 좁은 팔레트(흑/우드/청동/딥그린). '
             '주 시간대 = 낮게 깔리는 황금빛~저녁 텅스텐.</p>'
             f'<p class="route">후보정 베이스: {route(base_sig)}</p>'
             '<div class="gal">' + "".join(f'<img src="{b64(p)}">' for p, _, _ in sample(core, a.per)) + '</div></div>')
    H.append('<h2>■ 변주 (코어에서 갈리는 확실한 법칙만)</h2>')
    for cid, ko, rule_txt, _ in CHUNKS:
        grp = assigned[cid]
        if not grp:
            continue
        g_sig = avg([s for _, s, _ in grp])
        H.append(f'<div class="var"><h3>{ko} <span class="n">{len(grp)}장</span></h3>'
                 f'<p class="rule">법칙: {rule_txt}</p>'
                 f'<p class="route">Δ코어: {delta(g_sig, base_sig)}</p>'
                 '<div class="gal">' + "".join(f'<img src="{b64(p)}">' for p, _, _ in sample(grp, a.per)) + '</div></div>')
    H.append("</div></body></html>")
    out = os.path.join(os.path.expanduser(a.work), "direction.html")
    open(out, "w", encoding="utf-8").write("\n".join(H))
    print(f"✓ → {out}")
    print("배정:", {c[1]: len(assigned[c[0]]) for c in CHUNKS}, "core", len(core))


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
.gal img{width:104px;height:104px;object-fit:cover;border-radius:3px}
</style></head><body><div class="wrap"><h1>AMAN NEW YORK</h1>"""


if __name__ == "__main__":
    main()
