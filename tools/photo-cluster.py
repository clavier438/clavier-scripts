#!/usr/bin/env python3
# photo-cluster — 사진 더미(인스타 덤프 2천~9천 장)를 *시각 패턴별로 묶어* 대표만 뽑는다. claude 0·오프라인.
#
#   왜: brandRe folder 모드는 폴더의 *모든* 사진을 image-tagger 로 사진마다 비전 호출해 태깅한다.
#       계정 덤프 규모엔 비용·시간이 폭발. 아이디어(사용자): "저해상 그리드로 쫙 펼쳐 시각 패턴을
#       먼저 파악하고, 패턴 기반으로 대표만 추출하자. 무작위(균등) 추출은 패턴을 놓친다."
#   → 패턴(클러스터) 발견 = 로컬 무료, claude 0. 대표(representative)만 이후 태깅에 넘긴다.
#       층화 샘플링(stratified)이라 모든 시각 군집이 빠짐없이 대표된다.
#
#   특징(48~50차원, 로컬): 각 이미지 → 4×4 그리드 평균 RGB(=48) + 전역 채도·명도(=2). 0~1 정규화.
#   클러스터링: pure-python k-means++ (seeded·결정론적). numpy/sklearn 없이 — 이 규모엔 수 초.
#   산출: patterns/overview.jpg(군집당 medoid 1장+라벨) · patterns/cluster_NN.jpg(군집 contact-sheet)
#         · sample/(층화 대표 복사 — 이후 분석 대상) · manifest.json.
#
#   사용:
#     photo-cluster.py <src_image_dir> --out <dir> [--clusters 12] [--sample 60] [--tile-cap 80]
#   통합 (재사용 — sample 폴더만 만들고 분석은 기존 front door 가):
#     photo-cluster.py <src> --out $BRANDRE_BOOKS/<brand>/_cluster --sample 60
#     brandRe folder $BRANDRE_BOOKS/<brand>/_cluster/sample --as <brand>   # organize + 대표만 태깅
#
#   후속 옵션(이 PR 범위 밖, 주석만): 군집 의미 라벨링 = cluster_NN.jpg → claude 1콜씩(K콜)으로
#     "이 군집은 온천/네온/다기…" 명명. 여전히 개별 전수 태깅(N콜) 대비 K≪N.
#
#   reference: Lloyd k-means + k-means++ seeding (Arthur & Vassilvitskii 2007),
#     farthest-point(k-center greedy) 층화 대표 선택 (Gonzalez 1985).
import os, sys, glob, json, math, shutil, argparse, subprocess
from random import Random

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 모든 .py tool 첫 import, 없는 환경도 동작)
except ImportError:
    pass
from image_formats import PHOTO_EXTS, register_heif  # 사진 확장자 단일 소스 + HEIF 디코딩 등록
from PIL import Image
register_heif()  # .heic/.heif 도 Image.open 가능하게 (pillow-heif 없으면 graceful)

IMAGE_EXTS = PHOTO_EXTS
GRID = 4                  # 4×4 그리드 → 16칸 × RGB = 48차원
FEAT_DIM = GRID * GRID * 3 + 2   # +2 = 전역 채도·명도


# ── 특징 추출 (로컬, claude 0) ────────────────────────────────────────────────
def features(path):
    """이미지 → 50차원 0~1 벡터: 4×4 그리드 평균 RGB(48) + 전역 채도·명도(2). 못 읽으면 None."""
    try:
        im = Image.open(path).convert("RGB")
    except Exception:
        return None
    # 4×4 칸 평균색 = BOX 리샘플로 (4,4) 축소 → 각 픽셀이 칸 평균
    grid = im.resize((GRID, GRID), Image.BOX)
    vec = [c / 255.0 for px in grid.getdata() for c in px]   # 48
    # 전역 채도·명도: 작은 썸네일에서 HSV 평균 (vivid/neon ↔ muted 분리)
    small = im.copy(); small.thumbnail((64, 64))
    hsv = small.convert("HSV").getdata()
    n = len(hsv)
    s = sum(p[1] for p in hsv) / (n * 255.0) if n else 0.0
    v = sum(p[2] for p in hsv) / (n * 255.0) if n else 0.0
    vec += [s, v]                                            # 50
    return vec


# ── k-means++ (seeded·결정론적, pure python) ─────────────────────────────────
def sqdist(a, b):
    return sum((x - y) * (x - y) for x, y in zip(a, b))

def _nearest(v, centers):
    best, bd = 0, float("inf")
    for ci, c in enumerate(centers):
        d = sqdist(v, c)
        if d < bd:
            bd, best = d, ci
    return best, bd

def kmeanspp_init(feats, k, rng):
    """k-means++ seeding — 첫 중심 무작위(seeded), 이후 D² 비례 가중 선택. 퍼진 초기값."""
    n = len(feats)
    centers = [feats[rng.randrange(n)][:]]
    d2 = [sqdist(v, centers[0]) for v in feats]
    while len(centers) < k:
        total = sum(d2)
        if total <= 0:                       # 모든 점이 기존 중심과 동일 — 임의 채움
            centers.append(feats[rng.randrange(n)][:]); continue
        r = rng.random() * total
        acc = 0.0; pick = n - 1
        for i, w in enumerate(d2):
            acc += w
            if acc >= r:
                pick = i; break
        centers.append(feats[pick][:])
        for i, v in enumerate(feats):        # D² 갱신 (가장 가까운 중심까지)
            nd = sqdist(v, centers[-1])
            if nd < d2[i]:
                d2[i] = nd
    return centers

def kmeans(feats, k, iters, seed):
    rng = Random(seed)
    n = len(feats)
    k = min(k, n)
    centers = kmeanspp_init(feats, k, rng)
    assign = [0] * n
    for _ in range(iters):
        clusters = [[] for _ in range(k)]
        changed = False
        for idx, v in enumerate(feats):
            ci, _ = _nearest(v, centers)
            clusters[ci].append(idx)
            if assign[idx] != ci:
                assign[idx] = ci; changed = True
        for ci in range(k):
            members = clusters[ci]
            if members:
                centers[ci] = [sum(feats[i][d] for i in members) / len(members)
                               for d in range(FEAT_DIM)]
            else:                            # 빈 클러스터 재시드 = 자기 중심에서 가장 먼 점
                far = max(range(n), key=lambda i: sqdist(feats[i], centers[assign[i]]))
                centers[ci] = feats[far][:]
                changed = True
        if not changed:
            break
    return centers, assign


# ── 층화 대표: 군집 크기 비례 배분 + 군집 내 farthest-point 선택 ────────────────
def allocate(sizes, T):
    """군집 크기 비례로 대표 수 배분 (각 min 1, 합 ≈ T). 최대잔여(largest-remainder)."""
    k = len(sizes); total = sum(sizes)
    if T <= k:                               # T가 군집수보다 작으면 큰 군집부터 1씩
        counts = [0] * k
        for ci in sorted(range(k), key=lambda i: -sizes[i])[:T]:
            counts[ci] = 1
        return counts
    counts = [1] * k
    rem = T - k
    raw = [sizes[i] / total * rem for i in range(k)]
    add = [int(math.floor(x)) for x in raw]
    leftover = rem - sum(add)
    for i in sorted(range(k), key=lambda i: raw[i] - add[i], reverse=True)[:leftover]:
        add[i] += 1
    return [min(counts[i] + add[i], sizes[i]) for i in range(k)]

def farthest_points(members, feats, centroid, count):
    """군집 내 대표 선택: medoid(중심 최근접)부터 시작해 max-min 거리로 퍼뜨림 (spread)."""
    if count >= len(members):
        return list(members)
    medoid = min(members, key=lambda i: sqdist(feats[i], centroid))
    chosen = [medoid]; chosen_set = {medoid}
    while len(chosen) < count:
        best, bd = None, -1.0
        for m in members:
            if m in chosen_set:
                continue
            dmin = min(sqdist(feats[m], feats[s]) for s in chosen)
            if dmin > bd:
                bd, best = dmin, m
        chosen.append(best); chosen_set.add(best)
    return chosen


# ── montage (contact-sheet 타일링) ───────────────────────────────────────────
# ImageMagick(homebrew)는 ghostscript 없으면 기본 폰트 미설정 → -label/-title 렌더 시
# "unable to read font" 로 실패한다. 한글 라벨까지 위해 한글 지원 폰트를 우선 탐색.
_FONT_CANDIDATES = [
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",          # macOS (한글+ASCII)
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",     # Linux 한글
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",     # Linux fallback (한글X)
    "/System/Library/Fonts/Supplemental/Arial.ttf",        # ASCII fallback
]
def _montage_font():
    for f in _FONT_CANDIDATES:
        if os.path.exists(f):
            return f
    return None

def run_montage(tiles, out, geometry, labels=None, cols=None, title=None):
    """ImageMagick montage 호출. labels=각 타일 라벨(montage 는 -label 을 다음 이미지에 적용)."""
    mont = shutil.which("montage")
    if not mont:
        print("  ⚠ montage(ImageMagick) 없음 — contact-sheet 건너뜀"); return False
    if not tiles:
        return False
    cmd = [mont]
    font = _montage_font()
    if font:
        cmd += ["-font", font]
    if title:
        cmd += ["-title", title]
    for i, t in enumerate(tiles):
        if labels:
            cmd += ["-label", labels[i]]
        cmd.append(t)
    cmd += ["-tile", f"{cols or ''}x", "-geometry", geometry,
            "-background", "#1a1a1a", "-fill", "#dddddd", out]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=300)
        return True
    except Exception as e:
        msg = getattr(e, "stderr", "") or str(e)
        print(f"  ⚠ montage 실패 ({out}): {msg.strip()[:200]}")
        return False


def main():
    ap = argparse.ArgumentParser(
        description="사진 더미 → 시각 패턴 클러스터 → 층화 대표 추출 (claude 0·오프라인)")
    ap.add_argument("src", help="원본 이미지 폴더")
    ap.add_argument("--out", required=True, help="출력 폴더 (patterns/·sample/·manifest.json)")
    ap.add_argument("--clusters", type=int, default=12, help="클러스터 수 K (기본 12)")
    ap.add_argument("--sample", type=int, default=60, help="추출할 대표 총 수 T (기본 60)")
    ap.add_argument("--tile-cap", type=int, default=80, help="군집 contact-sheet 최대 타일 (기본 80)")
    ap.add_argument("--iters", type=int, default=25, help="k-means 반복 (기본 25)")
    ap.add_argument("--seed", type=int, default=0, help="결정론 seed (기본 0)")
    a = ap.parse_args()

    src = os.path.abspath(os.path.expanduser(a.src))
    out = os.path.abspath(os.path.expanduser(a.out))
    if not os.path.isdir(src):
        print(f"폴더 아님: {src}"); sys.exit(1)
    imgs = sorted(f for f in glob.glob(os.path.join(src, "**", "*"), recursive=True)
                  if os.path.isfile(f) and os.path.splitext(f)[1].lower() in IMAGE_EXTS
                  and not os.path.basename(f).startswith("."))
    if not imgs:
        print(f"이미지 없음: {src}"); sys.exit(1)

    # 1) 특징 추출 (로컬, claude 0)
    print(f"[photo-cluster] {len(imgs)}장 특징 추출 (4×4 RGB 그리드 + 채도·명도 = {FEAT_DIM}차원)")
    feats, paths = [], []
    for i, p in enumerate(imgs):
        v = features(p)
        if v is not None:
            feats.append(v); paths.append(p)
        if (i + 1) % 200 == 0:
            print(f"  …{i + 1}/{len(imgs)}  (읽음 {len(feats)})")
    n = len(feats)
    if n == 0:
        print("읽을 수 있는 이미지 없음"); sys.exit(1)
    print(f"  → {n}장 읽음 ({len(imgs) - n} skip)")

    # 2) k-means++
    k = max(1, min(a.clusters, n))
    print(f"[k-means++] K={k}, iters={a.iters}, seed={a.seed}")
    centers, assign = kmeans(feats, k, a.iters, a.seed)
    members = [[] for _ in range(k)]
    for idx, ci in enumerate(assign):
        members[ci].append(idx)
    # 빈 군집 제외 + 크기순 정렬 (재라벨 0..)
    order = sorted((ci for ci in range(k) if members[ci]), key=lambda ci: -len(members[ci]))
    print(f"  → {len(order)}개 비지 않은 군집:  " +
          " ".join(f"C{nid}={len(members[ci])}" for nid, ci in enumerate(order)))

    # 3) 출력 디렉토리
    pat_dir = os.path.join(out, "patterns")
    smp_dir = os.path.join(out, "sample")
    os.makedirs(pat_dir, exist_ok=True)
    os.makedirs(smp_dir, exist_ok=True)

    # 4) 층화 대표 배분 (군집 크기 비례)
    sizes = [len(members[ci]) for ci in order]
    counts = allocate(sizes, a.sample)

    manifest = {"clusters": [], "sample": [], "params": {
        "src": src, "clusters": k, "sample": a.sample, "tile_cap": a.tile_cap,
        "iters": a.iters, "seed": a.seed, "feat_dim": FEAT_DIM,
        "total_images": len(imgs), "read": n}}
    medoid_tiles, medoid_labels = [], []
    sample_files = set()

    for nid, ci in enumerate(order):
        mem = members[ci]; centroid = centers[ci]
        # 군집 내 중심 최근접순 (contact-sheet 정렬용)
        ranked = sorted(mem, key=lambda i: sqdist(feats[i], centroid))
        medoid = ranked[0]
        # 층화 대표 = farthest-point spread
        reps = farthest_points(mem, feats, centroid, counts[nid])
        rep_names = []
        for r in reps:
            base = os.path.basename(paths[r])
            dst = os.path.join(smp_dir, base)
            if dst in sample_files or os.path.exists(dst):    # 이름 충돌 회피 (C접두)
                base = f"C{nid:02d}_{base}"; dst = os.path.join(smp_dir, base)
            shutil.copy2(paths[r], dst)
            sample_files.add(dst)
            rep_names.append(base)
            manifest["sample"].append({"file": f"sample/{base}", "cluster": nid,
                                       "src": paths[r]})
        # 군집 contact-sheet (중심 가까운 순, tile-cap)
        sheet = os.path.join(pat_dir, f"cluster_{nid:02d}.jpg")
        run_montage([paths[i] for i in ranked[:a.tile_cap]], sheet, "160x160+2+2",
                    cols=int(math.ceil(math.sqrt(min(len(ranked), a.tile_cap)))),
                    title=f"C{nid}  n={len(mem)}  (대표 {len(reps)})")
        medoid_tiles.append(paths[medoid])
        medoid_labels.append(f"C{nid} n={len(mem)}")
        manifest["clusters"].append({
            "id": nid, "size": len(mem),
            "medoid": os.path.basename(paths[medoid]),
            "representatives": rep_names,
            "files": [os.path.basename(paths[i]) for i in ranked]})

    # 5) overview = 군집당 medoid 1장 + 라벨
    overview = os.path.join(pat_dir, "overview.jpg")
    ok = run_montage(medoid_tiles, overview, "220x220+6+6", labels=medoid_labels,
                     cols=int(math.ceil(math.sqrt(len(medoid_tiles)))),
                     title=f"{os.path.basename(src)} — {len(order)}개 시각 패턴 (medoid)")

    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\n✓ 완료 → {out}")
    print(f"  patterns/overview.jpg     {len(order)}개 패턴 한눈에" + ("" if ok else "  (montage 없음)"))
    print(f"  patterns/cluster_NN.jpg   군집별 contact-sheet")
    print(f"  sample/                   층화 대표 {len(sample_files)}장 (이후 태깅 대상)")
    print(f"  manifest.json")
    print(f"\n다음:  brandRe folder {smp_dir} --as <brand>")


if __name__ == "__main__":
    main()
