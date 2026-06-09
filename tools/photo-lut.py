#!/usr/bin/env python3
# photo-lut.py — 브랜드 사진들의 컬러그레이딩을 .cube 3D LUT 로 역추출 (design-recon).
#
# image-tagger 가 "무엇을(피사체·톤)" 분류한다면, photo-lut 은 "어떻게 그레이딩했나"
#   를 3D LUT 로 역추출한다. 단순 평균색이 아니라 *톤 구간별(섀도우/미드/하이라이트)
#   색통계* 로 split-toning·톤 형성 같은 그레이딩 서명을 잡아 identity 격자에 베이크.
#   보정 전 원본 없이 출력 사진만으로 가능 — Reinhard(2001) 색전이를 톤 구간으로 확장.
#
#   reference:
#     https://pyimagesearch.com/2014/06/30/super-fast-color-transfer-images/  (LAB mean/std 색전이)
#     https://colorscience.medium.com/get-any-preset-filter-look-in-minutes-fb7500c67315  (.cube 포맷)
#
# 한계: 전역 그레이딩 무드(색온도·split·콘트라스트)는 잡지만 로컬 마스킹/디테일은 근사.
#   numpy 없이 PIL + stdlib (17^3 격자라 가벼움 — 의존성 0 유지).
#
# 사용:
#   webExporter/.venv/bin/python tools/photo-lut.py <이미지폴더> [-o out.cube] [--strength 0.85]

import os, sys, glob, argparse
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 모든 .py tool 첫 import, 없는 환경도 동작)
except ImportError:
    pass
from image_formats import PHOTO_EXTS, register_heif  # 사진 확장자 단일 소스 + HEIF 디코딩 등록
register_heif()  # .heic/.heif 도 Image.open 가능하게 (pillow-heif 없으면 graceful)

LUT_SIZE = 17          # 17^3 = 4913 점 (.cube 표준, 가벼움)
SAMPLE_EDGE = 256      # 통계용 다운샘플 long-edge (속도)
IMAGE_EXTS = PHOTO_EXTS

# ── sRGB <-> CIELAB (D65) — 표준 색과학 변환 ─────────────────────────────────
def _srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _lin_to_srgb(c): return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
def _f(t):  return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
def _fi(t): return t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787

def rgb_to_lab(r, g, b):
    r, g, b = _srgb_to_lin(r), _srgb_to_lin(g), _srgb_to_lin(b)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722)
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    fx, fy, fz = _f(x), _f(y), _f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))

def lab_to_rgb(L, a, b):
    fy = (L + 16) / 116; fx = fy + a / 500; fz = fy - b / 200
    x, y, z = _fi(fx) * 0.95047, _fi(fy), _fi(fz) * 1.08883
    r = x * 3.2406 + y * -1.5372 + z * -0.4986
    g = x * -0.9689 + y * 1.8758 + z * 0.0415
    bb = x * 0.0557 + y * -0.2040 + z * 1.0570
    return tuple(min(1.0, max(0.0, _lin_to_srgb(min(1.0, max(0.0, c))))) for c in (r, g, bb))

# ── 그레이딩 서명: 톤 구간별 평균 LAB ────────────────────────────────────────
ZONES = ("shadow", "mid", "high")
def _zone(L): return "shadow" if L < 33 else "high" if L > 66 else "mid"

def grading_signature(path):
    """사진 → {zone: (L,a,b) 평균}. 톤 구간별 색 = split-toning/톤 형성 서명."""
    try:
        im = Image.open(path).convert("RGB"); im.thumbnail((SAMPLE_EDGE, SAMPLE_EDGE))
    except Exception:
        return None
    acc = {z: [0.0, 0.0, 0.0, 0] for z in ZONES}
    for r, g, b in im.getdata():
        L, A, B = rgb_to_lab(r / 255, g / 255, b / 255)
        z = acc[_zone(L)]; z[0] += L; z[1] += A; z[2] += B; z[3] += 1
    sig = {}
    for z in ZONES:
        L, A, B, n = acc[z]
        sig[z] = (L / n, A / n, B / n) if n else None
    return sig

def average_signatures(sigs):
    """여러 사진 서명 → 구간별 평균 (그룹 그레이딩)."""
    out = {}
    for z in ZONES:
        vals = [s[z] for s in sigs if s and s[z]]
        if vals:
            n = len(vals)
            out[z] = (sum(v[0] for v in vals) / n, sum(v[1] for v in vals) / n, sum(v[2] for v in vals) / n)
        else:
            out[z] = None
    return out

# ── identity 격자에 그레이딩 베이크 → .cube ──────────────────────────────────
def _interp_ab(L, anchors):
    """L(휘도) → (a,b) 시프트. 구간 앵커 사이 선형보간 = 톤별 색 (split-toning)."""
    pts = [p for p in anchors if p]
    if not pts: return (0.0, 0.0)
    if L <= pts[0][0]: return (pts[0][1], pts[0][2])
    if L >= pts[-1][0]: return (pts[-1][1], pts[-1][2])
    for i in range(len(pts) - 1):
        l0, a0, b0 = pts[i]; l1, a1, b1 = pts[i + 1]
        if l0 <= L <= l1:
            t = (L - l0) / (l1 - l0) if l1 > l0 else 0.0
            return (a0 + (a1 - a0) * t, b0 + (b1 - b0) * t)
    return (0.0, 0.0)

def bake_cube(sig, title, strength=0.85):
    """그레이딩 서명 → .cube 텍스트. 중립(무채 a=b=0) 대비 톤 구간별 (a,b) 시프트 적용.
    각 구간의 색조(a,b)를 휘도에 따라 보간해 입히므로 split-toning 이 LUT 에 반영된다."""
    anchors = []
    for z, Lref in (("shadow", 16), ("mid", 50), ("high", 83)):
        s = sig.get(z)
        anchors.append((Lref, s[1], s[2]) if s else None)
    anchors = [a for a in anchors if a]
    lines = [f'TITLE "{title}"', f"LUT_3D_SIZE {LUT_SIZE}",
             "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0", ""]
    N = LUT_SIZE - 1
    # .cube 는 red 가 가장 빨리 변하는 순서 (r 안쪽 루프)
    for bi in range(LUT_SIZE):
        for gi in range(LUT_SIZE):
            for ri in range(LUT_SIZE):
                r, g, b = ri / N, gi / N, bi / N
                L, A, B = rgb_to_lab(r, g, b)
                da, db = _interp_ab(L, anchors)
                ro, go, bo = lab_to_rgb(L, A + strength * da, B + strength * db)
                lines.append(f"{ro:.6f} {go:.6f} {bo:.6f}")
    return "\n".join(lines) + "\n"

def describe(sig):
    """구간별 색시프트를 사람이 읽게 (split-toning 요약)."""
    out = []
    for z in ZONES:
        s = sig.get(z)
        if not s: continue
        warm = "웜" if s[2] > 2 else "쿨" if s[2] < -2 else "중성"
        tint = " 마젠타" if s[1] > 6 else " 그린" if s[1] < -6 else ""
        out.append(f"  {z:6} L{s[0]:5.1f}  a{s[1]:+5.1f} b{s[2]:+5.1f}  → {warm}{tint}")
    return "\n".join(out)

# ── 정책 클러스터: 그레이딩 서명이 벌어지면 별도 그룹(→ 별도 LUT) ──────────────
def _sig_vec(sig):
    """서명 → 비교 벡터 (구간별 a,b). 정책(색조) 거리 계산용."""
    v = []
    for z in ZONES:
        s = sig.get(z); v += [s[1], s[2]] if s else [0.0, 0.0]
    return v

def _dist(v1, v2):
    return sum((x - y) ** 2 for x, y in zip(v1, v2)) ** 0.5

def cluster_signatures(items, threshold=22.0):
    """items=[(path,sig)] → 그레이딩 서명 거리 응집 클러스터.
    색조 정책이 threshold(LAB a/b 거리) 이상 벌어지면 별도 그룹. → [[(path,sig),...], ...]."""
    groups = []
    for path, sig in items:
        v = _sig_vec(sig)
        best, bd = None, 1e9
        for gi, gr in enumerate(groups):
            d = _dist(v, gr["centroid"])
            if d < bd: bd, best = d, gi
        if best is not None and bd <= threshold:
            gr = groups[best]; gr["items"].append((path, sig)); gr["vecs"].append(v)
            gr["centroid"] = [sum(c) / len(gr["vecs"]) for c in zip(*gr["vecs"])]
        else:
            groups.append({"vecs": [v], "items": [(path, sig)], "centroid": v})
    return [g["items"] for g in groups]

def main():
    ap = argparse.ArgumentParser(description="브랜드 사진 → 컬러그레이딩 .cube LUT (정책별 분리)")
    ap.add_argument("folder", help="이미지 폴더")
    ap.add_argument("-o", "--out", default=None, help="단일 그룹일 때 출력 경로 (기본: <folder>/<title>.cube)")
    ap.add_argument("--strength", type=float, default=0.85, help="그레이딩 강도 0~1 (기본 0.85)")
    ap.add_argument("--single", action="store_true", help="정책 클러스터 끄고 전체를 1개 LUT 로")
    ap.add_argument("--threshold", type=float, default=22.0, help="정책 분리 임계 색거리 (작을수록 잘게)")
    ap.add_argument("--outdir", default=None, help="LUT 출력 디렉토리 (기본: <folder>)")
    ap.add_argument("--title", default=None)
    a = ap.parse_args()
    root = os.path.abspath(os.path.expanduser(a.folder))
    imgs = [f for f in glob.glob(os.path.join(root, "**", "*"), recursive=True)
            if os.path.isfile(f) and os.path.splitext(f)[1].lower() in IMAGE_EXTS
            and not os.path.basename(f).startswith(".")]
    if not imgs:
        print(f"이미지 없음: {root}"); sys.exit(1)
    items = [(p, grading_signature(p)) for p in imgs]
    items = [(p, s) for p, s in items if s]
    if not items:
        print("서명 추출 실패"); sys.exit(1)
    title = a.title or os.path.basename(root.rstrip("/")) or "grading"
    groups = [items] if a.single else cluster_signatures(items, a.threshold)
    groups.sort(key=len, reverse=True)
    multi = len(groups) > 1
    outdir = a.outdir or root
    os.makedirs(outdir, exist_ok=True)
    print(f"[photo-lut] {len(items)}장 → {len(groups)}개 정책 그룹"
          f"{' (--single)' if a.single else ''}  (LUT_3D_SIZE {LUT_SIZE}, strength {a.strength})")
    for i, grp in enumerate(groups, 1):
        avg = average_signatures([s for _, s in grp])
        label = f"{title}_{i}" if multi else title
        out = (a.out if (a.out and not multi) else os.path.join(outdir, f"{label}.cube"))
        with open(out, "w") as f:
            f.write(bake_cube(avg, label, a.strength))
        print(f"\n  ▸ {label}.cube  ({len(grp)}장)")
        print(describe(avg))

if __name__ == "__main__":
    main()
