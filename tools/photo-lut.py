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

def _percentiles(hist, ps):
    """100-bin 휘도 히스토그램 → 퍼센타일 L 값들 (톤커브 제어점용)."""
    tot = sum(hist) or 1
    out, cum, i = [], 0, 0
    for p in ps:
        target = tot * p / 100.0
        while i < len(hist) - 1 and cum + hist[i] < target:
            cum += hist[i]; i += 1
        out.append(float(i))
    return tuple(out)

def grading_signature(path):
    """사진 → {zone:(L,a,b) 평균, '_lum':(p5,p50,p92)}. 톤 구간별 색(split-tone) + 휘도 분포(톤커브).
    _lum = 브랜드의 '얼마나 어둡게/블랙크러시/하이라이트압축' 톤 성격 — 색이 아닌 *톤* 서명."""
    try:
        im = Image.open(path).convert("RGB"); im.thumbnail((SAMPLE_EDGE, SAMPLE_EDGE))
    except Exception:
        return None
    acc = {z: [0.0, 0.0, 0.0, 0] for z in ZONES}
    hist = [0] * 101
    for r, g, b in im.getdata():
        L, A, B = rgb_to_lab(r / 255, g / 255, b / 255)
        z = acc[_zone(L)]; z[0] += L; z[1] += A; z[2] += B; z[3] += 1
        hist[max(0, min(100, int(L)))] += 1
    sig = {}
    for z in ZONES:
        L, A, B, n = acc[z]
        sig[z] = (L / n, A / n, B / n) if n else None
    sig["_lum"] = _percentiles(hist, (5, 50, 92))
    return sig

def average_signatures(sigs):
    """여러 사진 서명 → 구간별 평균 + _lum 평균 (그룹 그레이딩)."""
    out = {}
    for z in ZONES:
        vals = [s[z] for s in sigs if s and s[z]]
        if vals:
            n = len(vals)
            out[z] = (sum(v[0] for v in vals) / n, sum(v[1] for v in vals) / n, sum(v[2] for v in vals) / n)
        else:
            out[z] = None
    lums = [s["_lum"] for s in sigs if s and s.get("_lum")]
    if lums:
        out["_lum"] = tuple(sum(v) / len(lums) for v in zip(*lums))
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

# 중립 기준 휘도 퍼센타일(균형 잡힌 사진의 p5/p50/p92 위치). 톤커브 입력측 앵커.
_NEUTRAL_LUM = (8.0, 50.0, 90.0)
# 중립 서명: 무채(a=b=0) + 균형 휘도. transfer 의 '출발/도착' 자리표시 — bake_cube = 한쪽이 중립인 케이스.
_NEUTRAL_SIG = {"shadow": (16.0, 0.0, 0.0), "mid": (50.0, 0.0, 0.0),
                "high": (83.0, 0.0, 0.0), "_lum": _NEUTRAL_LUM}

def _tone_between(src_lum, dst_lum):
    """휘도 리매핑 함수 L(0~100)→L. src 의 (p5,p50,p92) 위치를 dst 의 위치로 옮긴다.
    = 한 톤 분포(어둡게/블랙크러시/하이라이트압축)를 다른 분포로. 단조 보장 위해 정렬+클램프."""
    if not src_lum or not dst_lum:
        return None
    pts = sorted([(0.0, 0.0), (src_lum[0], dst_lum[0]), (src_lum[1], dst_lum[1]),
                  (src_lum[2], dst_lum[2]), (100.0, 100.0)])
    for i in range(1, len(pts)):            # 단조 증가 강제 (역/교차 시 비단조 방지)
        if pts[i][1] < pts[i - 1][1]:
            pts[i] = (pts[i][0], pts[i - 1][1])

    def f(L):
        if L <= pts[0][0]:
            return pts[0][1]
        if L >= pts[-1][0]:
            return pts[-1][1]
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]; x1, y1 = pts[i + 1]
            if x0 <= L <= x1:
                t = (L - x0) / (x1 - x0) if x1 > x0 else 0.0
                return y0 + (y1 - y0) * t
        return L
    return f

def _tone_fn(lum, invert=False):
    """중립 ↔ 브랜드 톤커브. invert=False 면 중립→브랜드, True 면 브랜드→중립(그레이드 제거).
    _tone_between 의 한쪽 중립 특수 케이스."""
    if not lum:
        return None
    return _tone_between(lum, _NEUTRAL_LUM) if invert else _tone_between(_NEUTRAL_LUM, lum)

def _bake_grid(title, anchors, tone, strength):
    """identity 격자에 (휘도 톤커브 tone + 톤구간별 a/b 시프트 anchors) 를 베이크 → .cube 텍스트.
    bake_cube(중립↔브랜드)·bake_transfer(임의 from→to) 의 공통 코어 (DRY)."""
    lines = [f'TITLE "{title}"', f"LUT_3D_SIZE {LUT_SIZE}",
             "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0", ""]
    N = LUT_SIZE - 1
    for bi in range(LUT_SIZE):
        for gi in range(LUT_SIZE):
            for ri in range(LUT_SIZE):
                r, g, b = ri / N, gi / N, bi / N
                L, A, B = rgb_to_lab(r, g, b)
                Lo = tone(L) if tone else L
                da, db = _interp_ab(L, anchors)
                ro, go, bo = lab_to_rgb(Lo, A + strength * da, B + strength * db)
                lines.append(f"{ro:.6f} {go:.6f} {bo:.6f}")
    return "\n".join(lines) + "\n"

def bake_cube(sig, title, strength=0.85, invert=False):
    """그레이딩 서명 → .cube. *톤커브(휘도 L 리매핑)* + 톤구간별 (a,b) 색시프트 둘 다 베이크.
    중립 대비 브랜드 그레이드. invert=True 면 브랜드→중립 역변환(원본 추정). = bake_transfer 한쪽 중립 케이스."""
    anchors = []
    for z, Lref in (("shadow", 16), ("mid", 50), ("high", 83)):
        s = sig.get(z)
        if s:
            anchors.append((Lref, -s[1], -s[2]) if invert else (Lref, s[1], s[2]))
    return _bake_grid(title, anchors, _tone_fn(sig.get("_lum"), invert), strength)

def bake_transfer(from_sig, to_sig, title, strength=0.85):
    """두 그레이딩 서명 사이 .cube — from 의 룩을 to 의 룩으로. (출발 폴더 사진에 적용하면 모델 룩.)
    색시프트 = to.ab − from.ab (톤구간별), 톤커브 = from._lum → to._lum. bake_cube 는 from/to 한쪽이 중립."""
    anchors = []
    for z, Lref in (("shadow", 16), ("mid", 50), ("high", 83)):
        f, t = from_sig.get(z), to_sig.get(z)
        if f and t:
            anchors.append((Lref, t[1] - f[1], t[2] - f[2]))
    tone = _tone_between(from_sig.get("_lum"), to_sig.get("_lum"))
    return _bake_grid(title, anchors, tone, strength)

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

# ── 폴더 → 평균 서명 (transfer 의 from/to, reverse 의 base) ────────────────────
def _collect(folder):
    """폴더(재귀) 안 사진 경로 정렬 목록 — 숨김 제외. (main·transfer 공통 단일화)"""
    return sorted(f for f in glob.glob(os.path.join(folder, "**", "*"), recursive=True)
                  if os.path.isfile(f) and os.path.splitext(f)[1].lower() in IMAGE_EXTS
                  and not os.path.basename(f).startswith("."))

def folder_avg_sig(folder):
    """폴더 사진들 → (평균 그레이딩 서명, 장수). 빈 폴더면 (None, 0)."""
    sigs = [s for s in (grading_signature(p) for p in _collect(folder)) if s]
    return (average_signatures(sigs) if sigs else None), len(sigs)

def main():
    ap = argparse.ArgumentParser(description="브랜드 사진 → 컬러그레이딩 .cube LUT (정책별 분리)")
    ap.add_argument("folder", help="이미지 폴더")
    ap.add_argument("-o", "--out", default=None, help="단일 그룹일 때 출력 경로 (기본: <folder>/<title>.cube)")
    ap.add_argument("--strength", type=float, default=0.85, help="그레이딩 강도 0~1 (기본 0.85)")
    ap.add_argument("--single", action="store_true", help="정책 클러스터 끄고 전체를 1개 LUT 로")
    ap.add_argument("--threshold", type=float, default=22.0, help="정책 분리 임계 색거리 (작을수록 잘게)")
    ap.add_argument("--outdir", default=None, help="LUT 출력 디렉토리 (기본: <folder>)")
    ap.add_argument("--title", default=None)
    ap.add_argument("--inverse", action="store_true",
                    help="역변환 .cube 도 함께 출력 (<label>__inverse.cube) — 원본 추정용")
    ap.add_argument("--model", default=None,
                    help="모델(도착) 폴더 — 지정 시 transfer 모드: folder(출발)→model(도착) 룩 .cube 1개")
    a = ap.parse_args()
    root = os.path.abspath(os.path.expanduser(a.folder))
    if not os.path.isdir(root):
        print(f"폴더 아님: {root}"); sys.exit(1)
    outdir = a.outdir or root
    os.makedirs(outdir, exist_ok=True)

    # ── transfer 모드: 출발 → 모델 룩 LUT 1개 ─────────────────────────────────
    if a.model:
        model_root = os.path.abspath(os.path.expanduser(a.model))
        from_sig, nf = folder_avg_sig(root)
        to_sig, nt = folder_avg_sig(model_root)
        if not from_sig or not to_sig:
            print(f"서명 추출 실패 (출발 {nf}장 / 모델 {nt}장)"); sys.exit(1)
        title = a.title or f"{os.path.basename(root.rstrip('/'))}__to__{os.path.basename(model_root.rstrip('/'))}"
        out = a.out or os.path.join(outdir, f"{title}.cube")
        with open(out, "w") as f:
            f.write(bake_transfer(from_sig, to_sig, title, a.strength))
        print(f"[photo-lut] transfer  출발 {nf}장 → 모델 {nt}장  (strength {a.strength})")
        print(f"\n  ▸ {os.path.basename(out)}")
        print("  [출발]\n" + describe(from_sig))
        print("  [모델]\n" + describe(to_sig))
        return

    # ── 일반 모드: 브랜드 베이스 LUT 역추출 (정책별 N개) ──────────────────────
    items = [(p, s) for p, s in ((p, grading_signature(p)) for p in _collect(root)) if s]
    if not items:
        print(f"이미지/서명 없음: {root}"); sys.exit(1)
    title = a.title or os.path.basename(root.rstrip("/")) or "grading"
    groups = [items] if a.single else cluster_signatures(items, a.threshold)
    groups.sort(key=len, reverse=True)
    multi = len(groups) > 1
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
        if a.inverse:
            inv = os.path.join(outdir, f"{label}__inverse.cube")
            with open(inv, "w") as f:
                f.write(bake_cube(avg, f"{label}__inverse", a.strength, invert=True))
            print(f"  ▸ {label}__inverse.cube  (원본 추정용 역변환)")

if __name__ == "__main__":
    main()
