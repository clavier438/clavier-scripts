#!/usr/bin/env python3
# photo-treatment-cluster — 사진을 *어떻게 찍고 어떻게 후보정했나*(treatment) 로 묶는다. claude 0.
#
#   왜(사용자 원칙): 디렉션 분할의 기준은 "무엇을 찍고 뭘 전달하나"(semantic)가 아니라
#       "어떻게 찍고(노출·그림자·콘트라스트) 어떻게 후보정했나(색 그레이드)"(treatment) 다.
#       피사체로 나누면 같은 그레이드가 음식·오브제·객실에 흩어져 디렉션이 안 보인다.
#       → 순수 광학/톤 피처로만 묶는다. CLIP/semantic 은 분할에서 *제외*(피사체 누설),
#       중복제거·다양성·교차표에만 쓴다.
#
#   treatment 피처(이미지당, 의미 0·광학만):
#     · 톤구간(섀도/미드/하이) 점유율 f  = 키(low/high-key)·그림자 깊이 = "어떻게 찍고"
#     · 톤구간 평균 L                    = 노출
#     · 톤구간 평균 a,b                  = 색 그레이드 = "어떻게 후보정"
#     · 전역 채도 sat                    = 비비드 vs 뮤트
#     · 전역 콘트라스트 Lstd             = 하드 vs 소프트
#   → 데이터셋 z-score 정규화(각 차원 단위분산) 후 응집 클러스터(유클리드 threshold).
#     z-score 라 손-가중 없이 모든 축이 공평. 피처에 피사체 정보 0.
#
#   사용:
#     photo-treatment-cluster.py <folder> --out <dir> --clip <clip_embed.pt> [--threshold 3.2] [--per 50]
#   출력: <out>/treatment_samples/<NN>/ · <out>/_treatments.json
import os, sys, glob, json, argparse, shutil
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass
from image_formats import PHOTO_EXTS, register_heif
from PIL import Image
register_heif()

SAMPLE_EDGE = 256
ZONES = ("shadow", "mid", "high")


# ── sRGB→LAB (photo-lut 와 동일 색과학, 자급) ────────────────────────────────
def _lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _f(t):  return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
def rgb_to_lab(r, g, b):
    r, g, b = _lin(r), _lin(g), _lin(b)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722)
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    fx, fy, fz = _f(x), _f(y), _f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def _zone(L): return 0 if L < 33 else 2 if L > 66 else 1


def treatment_feature(path):
    """이미지 → 14-d 광학 treatment 피처 (의미 0). 못 읽으면 None.
    [f_sh,f_mid,f_hi, L_sh,L_mid,L_hi, a_sh,b_sh,a_mid,b_mid,a_hi,b_hi, sat, contrast]"""
    try:
        im = Image.open(path).convert("RGB"); im.thumbnail((SAMPLE_EDGE, SAMPLE_EDGE))
    except Exception:
        return None
    cnt = [0, 0, 0]; sumL = [0.0, 0.0, 0.0]; sumA = [0.0, 0.0, 0.0]; sumB = [0.0, 0.0, 0.0]
    Ls = []
    hsv = im.convert("HSV"); sat_sum = 0; n = 0
    for (r, g, b), (_, s, _v) in zip(im.getdata(), hsv.getdata()):
        L, A, B = rgb_to_lab(r / 255, g / 255, b / 255)
        z = _zone(L); cnt[z] += 1; sumL[z] += L; sumA[z] += A; sumB[z] += B
        Ls.append(L); sat_sum += s; n += 1
    if n == 0:
        return None
    tot = float(n)
    f = [cnt[z] / tot for z in range(3)]
    Lm = [(sumL[z] / cnt[z] if cnt[z] else (16, 50, 83)[z]) for z in range(3)]
    am = [(sumA[z] / cnt[z] if cnt[z] else 0.0) for z in range(3)]
    bm = [(sumB[z] / cnt[z] if cnt[z] else 0.0) for z in range(3)]
    mean_L = sum(Ls) / n
    contrast = (sum((x - mean_L) ** 2 for x in Ls) / n) ** 0.5
    sat = sat_sum / n / 255.0
    return [f[0], f[1], f[2], Lm[0], Lm[1], Lm[2],
            am[0], bm[0], am[1], bm[1], am[2], bm[2], sat, contrast]


def zscore(feats):
    """차원별 평균0·표준편차1 표준화 → 모든 축 공평."""
    d = len(feats[0]); n = len(feats)
    mean = [sum(f[j] for f in feats) / n for j in range(d)]
    std = [((sum((f[j] - mean[j]) ** 2 for f in feats) / n) ** 0.5) or 1.0 for j in range(d)]
    return [[(f[j] - mean[j]) / std[j] for j in range(d)] for f in feats], mean, std


def _dist(a, b): return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def kmeans(items, k, iters=40, seed=0):
    """proper Lloyd k-means + kmeans++ 시드 (결정론적). online 응집의 catch-all 문제 회피.
    items=[(name,vec)] → [[(name,vec),...] ...] (빈 군집 제외). z-score 입력 가정."""
    from random import Random
    rng = Random(seed)
    pts = [v for _, v in items]; n = len(pts); d = len(pts[0]); k = min(k, n)
    # kmeans++ 시드
    centers = [pts[rng.randrange(n)][:]]
    d2 = [_dist(p, centers[0]) ** 2 for p in pts]
    while len(centers) < k:
        tot = sum(d2) or 1.0; r = rng.random() * tot; acc = 0; pick = n - 1
        for i, w in enumerate(d2):
            acc += w
            if acc >= r:
                pick = i; break
        centers.append(pts[pick][:])
        for i, p in enumerate(pts):
            nd = _dist(p, centers[-1]) ** 2
            if nd < d2[i]:
                d2[i] = nd
    assign = [0] * n
    for _ in range(iters):
        changed = False
        clusters = [[] for _ in range(k)]
        for i, p in enumerate(pts):
            bi, bd = 0, 1e18
            for ci, c in enumerate(centers):
                dd = _dist(p, c)
                if dd < bd:
                    bd, bi = dd, ci
            clusters[bi].append(i)
            if assign[i] != bi:
                assign[i] = bi; changed = True
        for ci in range(k):
            if clusters[ci]:
                centers[ci] = [sum(pts[i][j] for i in clusters[ci]) / len(clusters[ci]) for j in range(d)]
            else:                                  # 빈 군집 = 가장 먼 점으로 재시드
                far = max(range(n), key=lambda i: _dist(pts[i], centers[assign[i]]))
                centers[ci] = pts[far][:]; changed = True
        if not changed:
            break
    out = [[] for _ in range(k)]
    for i, ci in enumerate(assign):
        out[ci].append(items[i])
    return [g for g in out if g]


def dedup_diverse(names, emb_map, per, dup=0.92):
    vs = [(n, emb_map[n]) for n in names if n in emb_map]
    if not vs:
        return names[:per]
    def cos(a, b): return sum(x * y for x, y in zip(a, b))
    kept = []
    for n, v in vs:
        if all(cos(v, kv) <= dup for _, kv in kept):
            kept.append((n, v))
    if len(kept) <= per:
        return [n for n, _ in kept]
    chosen = [kept[0]]; cs = {kept[0][0]}
    while len(chosen) < per:
        best, bd = None, -1
        for n, v in kept:
            if n in cs:
                continue
            dmin = min(1 - cos(v, cv) for _, cv in chosen)
            if dmin > bd:
                bd, best = dmin, (n, v)
        chosen.append(best); cs.add(best[0])
    return [n for n, _ in chosen]


def describe_feat(raw):
    """평균 raw 피처 → 사람이 읽는 treatment 한 줄 (의미 아님, 광학)."""
    f_sh, f_mid, f_hi, L_sh, L_mid, L_hi, a_sh, b_sh, a_mid, b_mid, a_hi, b_hi, sat, con = raw
    key = "로우키(그림자깊음)" if f_sh > 0.45 else "하이키(밝음)" if f_hi > 0.4 else "미드키"
    warm = "웜" if (b_sh + b_mid + b_hi) / 3 > 4 else "쿨/틸" if (b_sh + b_mid + b_hi) / 3 < -2 else "중성"
    grn = "그린" if (a_mid) < -3 else "마젠타" if (a_mid) > 8 else ""
    chroma = "비비드" if sat > 0.45 else "뮤트" if sat < 0.28 else ""
    contrast = "고대비" if con > 28 else "저대비" if con < 16 else ""
    return f"{key}·{warm}{grn}·{chroma}{(' '+contrast) if contrast else ''}  (섀도{f_sh:.0%} sat{sat:.2f} 콘{con:.0f})"


def main():
    ap = argparse.ArgumentParser(description="treatment(어떻게 찍고·후보정)별 클러스터 + 다양성 샘플")
    ap.add_argument("folder"); ap.add_argument("--out", required=True)
    ap.add_argument("--clip", required=True, help="clip_embed.pt (dedup·다양성·교차표)")
    ap.add_argument("--k", type=int, default=9, help="treatment 그룹 수 (k-means)")
    ap.add_argument("--per", type=int, default=50)
    ap.add_argument("--min-group", type=int, default=12)
    a = ap.parse_args()
    import torch
    src = os.path.abspath(os.path.expanduser(a.folder))
    imgs = sorted(f for f in glob.glob(os.path.join(src, "**", "*"), recursive=True)
                  if os.path.isfile(f) and os.path.splitext(f)[1].lower() in PHOTO_EXTS
                  and not os.path.basename(f).startswith("."))
    os.makedirs(a.out, exist_ok=True)

    # 1) treatment 피처 (캐시)
    cache = os.path.join(a.out, "_treat_feat.json")
    if os.path.exists(cache):
        raw = json.load(open(cache))
    else:
        print(f"[treatment] {len(imgs)}장 광학 피처 추출…")
        raw = {}
        for i, p in enumerate(imgs):
            v = treatment_feature(p)
            if v:
                raw[os.path.basename(p)] = v
            if (i + 1) % 300 == 0:
                print(f"  …{i+1}/{len(imgs)}")
        json.dump(raw, open(cache, "w"))
    names = list(raw); feats = [raw[n] for n in names]

    # 2) z-score → k-means (proper Lloyd + kmeans++, catch-all 회피)
    #    ref: en.wikipedia.org/wiki/K-means_clustering · /wiki/K-means%2B%2B (Arthur&Vassilvitskii 2007)
    zf, _, _ = zscore(feats)
    groups = kmeans(list(zip(names, zf)), a.k)
    groups = [g for g in groups if len(g) >= a.min_group]
    groups.sort(key=len, reverse=True)
    print(f"  → {len(groups)}개 treatment 그룹: " + " ".join(f"T{i}={len(g)}" for i, g in enumerate(groups)))

    # 3) CLIP dedup·다양성
    ck = torch.load(os.path.expanduser(a.clip))
    emb = {n: ck["emb"][i].tolist() for i, n in enumerate(ck["names"])}
    src_by = {os.path.basename(p): p for p in imgs}
    smp = os.path.join(a.out, "treatment_samples")
    if os.path.exists(smp):
        shutil.rmtree(smp)
    os.makedirs(smp)
    man = {"groups": [], "params": {"k": a.k, "per": a.per}}
    for gi, g in enumerate(groups):
        gn = [n for n, _ in g]                      # 그룹 전체(평균·describe 용)
        # treatment 이상치 트리밍: 센트로이드(z-공간)에서 먼 18%(경계 오배정) 제거 후 다양성 추출.
        #   → "같은 treatment가 여러 피사체에 걸친" 다양성은 살리고, 명백히 다른 룩(밝은 주광 등)은 뺀다.
        cen = [sum(v[j] for _, v in g) / len(g) for j in range(len(g[0][1]))]
        ranked = sorted(g, key=lambda nv: _dist(nv[1], cen))
        typical = [n for n, _ in ranked[:max(a.per, int(len(ranked) * 0.82))]]
        reps = dedup_diverse(typical, emb, a.per)
        gdir = os.path.join(smp, f"{gi:02d}"); os.makedirs(gdir, exist_ok=True)
        for n in reps:
            if n in src_by:
                shutil.copy2(src_by[n], os.path.join(gdir, n))
        avg_raw = [sum(raw[n][j] for n in gn) / len(gn) for j in range(len(feats[0]))]
        desc = describe_feat(avg_raw)
        man["groups"].append({"id": f"T{gi}", "size": len(gn), "samples": reps,
                              "dir": f"treatment_samples/{gi:02d}",
                              "feature": [round(x, 2) for x in avg_raw], "describe": desc})
        print(f"  T{gi}: {len(gn):4}장 → 다양성 {len(reps):2}장 | {desc}")
    json.dump(man, open(os.path.join(a.out, "_treatments.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"\n✓ treatment_samples/ + _treatments.json → {a.out}")


if __name__ == "__main__":
    main()
