#!/usr/bin/env python3
# mukayu_costyle.py — mukayu 출력 사진 → 톤 시그니처 역추출 → costyle 세트.
#   reuse-first: photo-lut.py 의 grading_signature/average/describe/cluster 를 import 재사용.
#   정직성 원칙: 색 시그니처(split-toning)만 사진에서 역추출(BASE 컬러). 톤/HDR 은 출력만으론
#     역산 불가(underdetermined) → 큐레이션 극단값 유지, 사진은 카테고리 톤분포 '설명'에만.
import sys, os, importlib.util, uuid, math

REPO = "/Users/clavier/dev/clavier/clavier-scripts"
sys.path.insert(0, os.path.join(REPO, "tools"))
sys.path.insert(0, os.path.join(REPO, "tools", "lib"))
spec = importlib.util.spec_from_file_location("photo_lut", os.path.join(REPO, "tools", "photo-lut.py"))
PL = importlib.util.module_from_spec(spec); spec.loader.exec_module(PL)

SRC = os.path.expanduser("~/Desktop/mukayu")
OUT = os.path.expanduser("~/Library/Application Support/Capture One/Styles/Mukayu (from photos)")
os.makedirs(OUT, exist_ok=True)

# ── 1. 폴더(카테고리)별 + 전체 시그니처 ──────────────────────────────────────
folders = sorted([os.path.join(SRC, d) for d in os.listdir(SRC)
                  if os.path.isdir(os.path.join(SRC, d)) and not d.startswith(".")])
all_sigs, cat_rows, items = [], [], []
print("="*72)
print("mukayu 카테고리별 톤 시그니처 (LAB split-toning + 휘도분포)")
print("="*72)
for fp in folders:
    sigs = [s for s in (PL.grading_signature(p) for p in PL._collect(fp)) if s]
    if not sigs: continue
    all_sigs += sigs
    items += [(p, PL.grading_signature(p)) for p in PL._collect(fp)]
    avg = PL.average_signatures(sigs)
    lum = avg.get("_lum", (0,0,0))
    name = os.path.basename(fp)
    print(f"\n▶ {name}  ({len(sigs)}장)   휘도 p5={lum[0]:.0f} p50={lum[1]:.0f} p92={lum[2]:.0f}")
    print(PL.describe(avg))
    cat_rows.append((name, len(sigs), lum, avg))

overall = PL.average_signatures(all_sigs)
olum = overall.get("_lum", (0,0,0))
print("\n" + "="*72)
print(f"■ 전체 평균 ({len(all_sigs)}장)   휘도 p5={olum[0]:.0f} p50={olum[1]:.0f} p92={olum[2]:.0f}")
print(PL.describe(overall))

# ── 2. 색조 클러스터 (몇 개의 '룩'으로 갈리나) ────────────────────────────────
items = [(p, s) for p, s in items if s]
clusters = PL.cluster_signatures(items, threshold=18.0)
clusters = sorted(clusters, key=lambda g: -len(g))
print("\n" + "="*72)
print(f"색조 클러스터: {len(clusters)}개 그룹")
for i, g in enumerate(clusters[:5]):
    cavg = PL.average_signatures([s for _, s in g])
    print(f"\n  [{i}] {len(g)}장")
    print("  " + PL.describe(cavg).replace("\n", "\n  "))

# ── 3. 시그니처 → costyle 매핑 ───────────────────────────────────────────────
def cast_to_mult(Lref, a, b, gain, lo=0.86, hi=1.14):
    """톤구간 LAB 색캐스트 → CO ColorBalance R;G;B 배율(1.0 근방). gain 으로 극단화."""
    rn, gn, bn = PL.lab_to_rgb(Lref, 0.0, 0.0)
    rc, gc, bc = PL.lab_to_rgb(Lref, a * gain, b * gain)
    m = lambda c, n: max(lo, min(hi, c / n)) if n > 1e-3 else 1.0
    return (m(rc, rn), m(gc, gn), m(bc, bn))

GAIN = 1.3  # split-tone 상대 토닝 증폭 (과하지 않게). 적용 강도는 Opacity.
def fmt3(t): return ";".join(f"{x:.6f}" for x in t)

sh, mid, hi = overall["shadow"], overall["mid"], overall["high"]
# 미드톤을 중립 기준으로 → shadow/high 의 '상대' 토닝만 추출 (피사체·전역 웜은 제거).
ma, mb = mid[1], mid[2]
cb_sh = cast_to_mult(sh[0], sh[1] - ma, sh[2] - mb, GAIN)
cb_md = (1.0, 1.0, 1.0)
cb_hi = cast_to_mult(hi[0], hi[1] - ma, hi[2] - mb, GAIN)

# 전체 평균 채도 → Saturation (낮으면 음수). 이미 desat 된 출력이라 절반만 반영.
chroma = sum(math.hypot(overall[z][1], overall[z][2]) for z in PL.ZONES) / 3
sat = int(max(-12, min(5, round((chroma - 18) * 0.8))))

print("\n" + "="*72)
print("BASE 매핑 결과 (사진 역추출):")
print(f"  ColorBalanceShadow    = {fmt3(cb_sh)}")
print(f"  ColorBalanceMidtone   = {fmt3(cb_md)}")
print(f"  ColorBalanceHighlight = {fmt3(cb_hi)}")
print(f"  평균 채도 C={chroma:.1f} → Saturation = {sat}")

def style_file(name, body_kvs):
    u = str(uuid.uuid4()).upper()
    lines = [f'\t\t\t<E K="{k}" V="{v}" />' for k, v in sorted(body_kvs.items())]
    return f'''<?xml version="1.0"?>
<SL Engine="1300">
\t<E K="Name" V="{name}" />
\t<E K="UUID" V="{u}" />
</SL>
<LDS>
\t<LD>
\t\t<LA>
{chr(10).join(lines)}
\t\t</LA>
\t\t<MDS>
\t\t\t<MD>
\t\t\t\t<E K="BlendMode" V="0" />
\t\t\t\t<E K="Density" V="1" />
\t\t\t\t<E K="MaskType" V="1" />
\t\t\t</MD>
\t\t</MDS>
\t</LD>
</LDS>
'''

# BASE — 사진 역추출 컬러 DNA
base = {
    "Name": "M_BASE_Core", "Opacity": "100", "Enabled": "1",
    "ColorBalanceShadow": fmt3(cb_sh),
    "ColorBalanceMidtone": fmt3(cb_md),
    "ColorBalanceHighlight": fmt3(cb_hi),
    "Saturation": str(sat),
}

# Indoor/Outdoor — 톤 큐레이션 극단(출력에서 역산 불가). 카테고리 휘도로 방향만 확인.
indoor = {"Name": "M_Indoor", "Opacity": "100", "Enabled": "1",
          "HighlightRecoveryEx": "-90", "WhiteRecovery": "-100",
          "BlackRecovery": "-95", "ShadowRecovery": "85"}
outdoor = {"Name": "M_Outdoor", "Opacity": "100", "Enabled": "1",
           "HighlightRecoveryEx": "-20", "WhiteRecovery": "-10",
           "BlackRecovery": "-40", "ShadowRecovery": "40"}
util = {"Name": "M_Util", "Opacity": "100", "Enabled": "1",
        "Clarity": "30", "ClarityMethod": "2", "ClarityStructure": "25",
        "UsmAmount": "180", "UsmRadius": "1", "Vignetting": "-45",
        "FilmGrainAmount": "20", "FilmGrainType": "2",
        "FilmGrainGranularity": "50", "FilmGrainDensity": "0"}

for n, kv in [("M_BASE_Core", base), ("M_Indoor", indoor),
              ("M_Outdoor", outdoor), ("M_Util", util)]:
    with open(os.path.join(OUT, n + ".costyle"), "w") as f:
        f.write(style_file(n, kv))

print("\n" + "="*72)
print(f"✅ 4개 스타일 → {OUT}")
for n in ("M_BASE_Core", "M_Indoor", "M_Outdoor", "M_Util"):
    print(f"   {n}.costyle")
