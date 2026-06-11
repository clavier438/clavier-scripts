#!/usr/bin/env python3
# photo-normalize.py — 사진들의 *시작값을 한 목표 분포로 정규화* (per-photo Reinhard mean+std).
#
#   photo-lut 가 "여러 사진의 평균 그레이딩 → LUT 1개" 라면, normalize 는 거울이다:
#     사진 *한 장 한 장* 을 목표 분포(평균+표준편차)로 맞춰 **시작값을 똑같이** 만든다.
#     → 그 위에 브랜드 LUT 을 일괄 적용하면 결과가 일정. ("일괄 LUT 의 전제 = 시작값 동일")
#
#   왜 per-photo 인가: transfer(폴더 평균→평균) 는 배치 전체를 같은 양만큼 밀 뿐 *개별
#     편차는 그대로* 남긴다. normalize 는 사진마다 다른 변환을 구워 편차 자체를 줄인다.
#
#   기법 (1단계 = 풀 Reinhard): LAB 채널별 (mean, std) 매칭.
#     out_c = (in_c - μ_src,c) · (σ_dst,c / σ_src,c) + μ_dst,c   (c ∈ {L,a,b})
#     = 색캐스트(mean) + 대비/분산(std) 둘 다 맞춤. 전역 저차 통계라 콘텐츠에 robust.
#     (다음 단계 후보 = MKL 공분산 매칭 — 채널 상관까지. 미리보기로 부족하면 올림.)
#     ref: https://pyimagesearch.com/2014/06/30/super-fast-color-transfer-images/  (LAB mean/std)
#
#   목표(target) 분포:
#     --model <folder> → 모델 폴더 픽셀 풀 통계 (외부 룩으로 통일).
#     --ref   <photo>  → 그 한 장의 통계 (기준 컷으로 통일).
#     (둘 다 없음)      → 자기 폴더 픽셀 풀 통계 (folder=config — 평균이 기본 기준).
#
#   산출: 사진마다 .cube 1개 (--cubedir) + manifest.json (photo↔cube 절대경로).
#     적용은 Node(apply.mjs/ffmpeg)가 manifest 를 읽어 — Python 은 색수학·베이크만 (drift 차단).
#
#   의존성 0 (PIL + stdlib). 색변환·클러스터 감지는 photo-lut 재사용 (중복 색수학 금지).

import os, sys, json, argparse, importlib.util

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경도 동작)
except ImportError:
    pass
from pydeps import ensure  # 실행 의존성 자동 설치 (CONVENTIONS "의존성 자동 설치 원칙")
Image = ensure("pillow", "PIL.Image")  # 없으면 자동 설치 — 사용자에 떠넘기지 않음
from image_formats import find_images, register_heif  # 사진 탐색·HEIF 등록 단일 소스
register_heif()

# photo-lut 의 검증된 색수학 재사용 (rgb↔lab round-trip err 0.00012, .cube 포맷, 정책 클러스터).
#   파일명이 하이픈이라 importlib 로 로드 — 색변환을 복붙하면 drift(reuse-first 훅).
_PL = os.path.join(os.path.dirname(os.path.realpath(__file__)), "photo-lut.py")
_spec = importlib.util.spec_from_file_location("photo_lut", _PL)
photo_lut = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(photo_lut)
rgb_to_lab, lab_to_rgb = photo_lut.rgb_to_lab, photo_lut.lab_to_rgb
LUT_SIZE = photo_lut.LUT_SIZE

SAMPLE_EDGE = 256      # 통계용 다운샘플 long-edge (속도 — grading_signature 와 동일)
RATIO_CLAMP = (0.25, 4.0)  # σ_dst/σ_src 클램프 — 평탄 이미지(σ≈0)에서 폭주 방지

# ── 픽셀 통계: LAB mean + 공분산 3x3 (합/제곱합/교차합 — 17^3 격자라 가벼움) ──
#   reinhard 는 대각(std)만, mkl 은 전체 공분산을 쓴다. 교차항은 픽셀당 3곱 추가 = 무시할 비용.
def _accumulate(path, acc):
    """한 사진의 LAB 픽셀을 acc(길이 10)에 누적. 실패 시 False.
    acc = [n, sL,sA,sB, sLL,sAA,sBB, sLA,sLB,sAB]."""
    try:
        im = Image.open(path).convert("RGB"); im.thumbnail((SAMPLE_EDGE, SAMPLE_EDGE))
    except Exception:
        return False
    for r, g, b in im.getdata():
        L, A, B = rgb_to_lab(r / 255, g / 255, b / 255)
        acc[0] += 1
        acc[1] += L; acc[2] += A; acc[3] += B
        acc[4] += L * L; acc[5] += A * A; acc[6] += B * B
        acc[7] += L * A; acc[8] += L * B; acc[9] += A * B
    return True

def _finish(acc):
    """누적 → {'mean':[L,a,b], 'cov':3x3, 'std':[L,a,b], 'n':픽셀수}. 빈 경우 None."""
    n = acc[0]
    if not n:
        return None
    mean = [acc[1] / n, acc[2] / n, acc[3] / n]
    cv = lambda s, i, j: acc[s] / n - mean[i] * mean[j]   # E[xy] - E[x]E[y]
    cov = [[cv(4, 0, 0), cv(7, 0, 1), cv(8, 0, 2)],
           [cv(7, 0, 1), cv(5, 1, 1), cv(9, 1, 2)],
           [cv(8, 0, 2), cv(9, 1, 2), cv(6, 2, 2)]]
    std = [max(0.0, cov[i][i]) ** 0.5 for i in range(3)]
    return {"mean": mean, "cov": cov, "std": std, "n": n}

def image_stats(path):
    acc = [0] + [0.0] * 9
    return _finish(acc) if _accumulate(path, acc) else None

def pooled_stats(paths):
    """여러 사진 픽셀을 *풀링* → 목표 분포 통계 (per-photo 평균이 아니라 전체 픽셀 합)."""
    acc = [0] + [0.0] * 9
    used = 0
    for p in paths:
        if _accumulate(p, acc):
            used += 1
    return _finish(acc), used

# ── Reinhard 채널별 affine → .cube 베이크 ────────────────────────────────────
def _reinhard_fn(src, dst, strength):
    """LAB (L,a,b) → 정규화된 (L,a,b). 채널별 (in-μs)·(σd/σs)+μd, strength 로 항등 블렌드."""
    ratio = []
    for i in range(3):
        ss, ds = src["std"][i], dst["std"][i]
        r = ds / ss if ss > 1e-6 else 1.0
        ratio.append(min(RATIO_CLAMP[1], max(RATIO_CLAMP[0], r)))
    sm, dm = src["mean"], dst["mean"]

    def f(L, A, B):
        out = []
        for i, v in enumerate((L, A, B)):
            mapped = (v - sm[i]) * ratio[i] + dm[i]
            out.append(v + strength * (mapped - v))  # strength=1 → 완전 매칭
        return out
    return f

# ── MKL (Monge-Kantorovich Linear, Pitié & Kokaram 2007) — 공분산까지 맞춤 (opt-in) ──
#   reinhard 는 채널별 독립(대각)이라 채널 상관(강한 색캐스트=R,B 동조 등)을 못 잡는다.
#   MKL = 평균+공분산을 옮기는 closed-form 선형해 — 채널 상관까지 맞춰 색틀어짐 감소.
#     T = Σs^(-1/2) (Σs^(1/2) Σt Σs^(1/2))^(1/2) Σs^(-1/2),  out = T(in-μs)+μt
#   numpy 필요(대칭 PSD 고유분해) — 기본 reinhard 의 0-dep 를 깨지 않으려 lazy import.
#   ref: https://github.com/mahmoudnafifi/colour_transfer_MKL  (Pitié linear MK)
def _mkl_matrix(src_cov, dst_cov):
    import numpy as np  # lazy — mkl 에서만. 없으면 main 이 먼저 친절히 안내.
    def _ridge(C):
        """저분산/특이 공분산(거의 단색·1D 그라디언트 컷) 정규화 — Σ^(-1/2) 폭발 차단.
        λ = trace/3 · 1e-3 (분산 스케일 비례 ridge). 없으면 rank-결손 방향이 무한 증폭."""
        C = np.array(C, dtype=float)
        lam = max(np.trace(C) / 3.0 * 1e-3, 1e-6)
        return C + lam * np.eye(3)
    def _sym_pow(A, p):
        w, V = np.linalg.eigh(A)                           # 대칭 → 실고유값
        w = np.clip(w, max(float(w.max()) * 1e-6, 1e-9), None)
        return V @ np.diag(w ** p) @ V.T
    Ss = _ridge(src_cov)
    Ss_half, Ss_ihalf = _sym_pow(Ss, 0.5), _sym_pow(Ss, -0.5)
    mid = _sym_pow(Ss_half @ _ridge(dst_cov) @ Ss_half, 0.5)
    return (Ss_ihalf @ mid @ Ss_ihalf).tolist()           # 3x3 → 핫루프는 순수 python

def _mkl_fn(src, dst, strength):
    """LAB (L,a,b) → MKL 변환된 (L,a,b). T 는 numpy 로 1회 계산, 격자 적용은 순수 python."""
    T = _mkl_matrix(src["cov"], dst["cov"])
    sm, dm = src["mean"], dst["mean"]

    def f(L, A, B):
        d = (L - sm[0], A - sm[1], B - sm[2])
        v = (L, A, B)
        out = []
        for i in range(3):
            mapped = dm[i] + T[i][0] * d[0] + T[i][1] * d[1] + T[i][2] * d[2]
            out.append(v[i] + strength * (mapped - v[i]))  # strength 항등 블렌드
        return out
    return f

def bake_normalize(src, dst, strength, title, method="reinhard"):
    """identity 격자에 정규화 변환을 베이크 → .cube 텍스트 (photo-lut 와 같은 17^3 포맷).
    method='reinhard'(채널 mean+std, 0-dep) | 'mkl'(평균+공분산, numpy)."""
    f = _mkl_fn(src, dst, strength) if method == "mkl" else _reinhard_fn(src, dst, strength)
    N = LUT_SIZE - 1
    lines = [f'TITLE "{title}"', f"LUT_3D_SIZE {LUT_SIZE}",
             "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0", ""]
    for bi in range(LUT_SIZE):
        for gi in range(LUT_SIZE):
            for ri in range(LUT_SIZE):
                L, A, B = rgb_to_lab(ri / N, gi / N, bi / N)
                Lo, Ao, Bo = f(L, A, B)
                ro, go, bo = lab_to_rgb(Lo, Ao, Bo)  # lab_to_rgb 가 0~1 클램프
                lines.append(f"{ro:.6f} {go:.6f} {bo:.6f}")
    return "\n".join(lines) + "\n"

# ── 섞인 룩 경고 (강제 분리 X — 다음 단계 결정) ───────────────────────────────
def _mixed_look_warning(src_paths, threshold):
    """grading_signature + cluster_signatures 재사용 — 정책 클러스터 2개+ 면 경고만 출력."""
    items = [(p, s) for p, s in ((p, photo_lut.grading_signature(p)) for p in src_paths) if s]
    if not items:
        return
    groups = photo_lut.cluster_signatures(items, threshold)
    if len(groups) > 1:
        sizes = ", ".join(str(len(g)) for g in sorted(groups, key=len, reverse=True))
        print(f"  ⚠ 섞인 룩 감지 — 그레이딩 정책 {len(groups)}개 그룹({sizes}장). "
              f"하나의 목표로 정규화하면 의도된 차이를 뭉갤 수 있음.")
        print(f"    (지금은 경고만 — 클러스터별 분리는 다음 단계. --ref 로 기준 컷을 못 박거나 "
              f"폴더를 룩별로 나눠 따로 돌리는 게 안전.)")

def _describe(stats, label):
    m, s = stats["mean"], stats["std"]
    print(f"  [{label}] mean L{m[0]:5.1f} a{m[1]:+5.1f} b{m[2]:+5.1f}  ·  "
          f"std L{s[0]:4.1f} a{s[1]:4.1f} b{s[2]:4.1f}  ({stats['n']:,}px)")

def main():
    ap = argparse.ArgumentParser(description="사진 시작값을 목표 분포로 정규화 (per-photo Reinhard)")
    ap.add_argument("folder", help="적용(정규화 대상) 폴더")
    ap.add_argument("--model", default=None, help="모델 폴더 — 이 룩으로 통일 (없으면 자기 폴더 평균)")
    ap.add_argument("--ref", default=None, help="기준 사진 1장 — 이 컷으로 통일 (--model 보다 우선)")
    ap.add_argument("--strength", type=float, default=1.0, help="정규화 강도 0~1 (기본 1.0=완전 매칭)")
    ap.add_argument("--method", choices=("reinhard", "mkl"), default="reinhard",
                    help="reinhard=채널 mean+std (기본, 0-dep) · mkl=평균+공분산 (numpy 자동설치)")
    ap.add_argument("--cubedir", required=True, help="per-photo .cube 출력 디렉토리")
    ap.add_argument("--manifest", default=None, help="manifest.json 경로 (기본: <cubedir>/manifest.json)")
    ap.add_argument("--threshold", type=float, default=22.0, help="섞인 룩 경고 임계 색거리")
    a = ap.parse_args()

    if a.method == "mkl":  # opt-in 경로 — numpy 필요. 없으면 자동 설치 (수동 안내 금지 원칙)
        ensure("numpy")

    root = os.path.abspath(os.path.expanduser(a.folder))
    if not os.path.isdir(root):
        print(f"폴더 아님: {root}"); sys.exit(1)
    src_paths = find_images(root)
    if not src_paths:
        print(f"사진 없음: {root}"); sys.exit(1)

    # ── 목표 분포 결정: ref > model > 자기 폴더 평균 ──
    if a.ref:
        ref = os.path.abspath(os.path.expanduser(a.ref))
        dst = image_stats(ref)
        if not dst:
            print(f"기준 사진 통계 실패: {ref}"); sys.exit(1)
        target_label = f"ref={os.path.basename(ref)}"
    elif a.model:
        model_root = os.path.abspath(os.path.expanduser(a.model))
        model_paths = find_images(model_root)
        dst, used = pooled_stats(model_paths)
        if not dst:
            print(f"모델 통계 실패: {model_root}"); sys.exit(1)
        target_label = f"model={os.path.basename(model_root)} ({used}장 풀)"
    else:
        dst, used = pooled_stats(src_paths)
        if not dst:
            print(f"자기 폴더 통계 실패: {root}"); sys.exit(1)
        target_label = f"self-avg ({used}장 풀)"

    print(f"[normalize] {len(src_paths)}장 → 목표 {target_label}  "
          f"(method {a.method}, strength {a.strength}, LUT_3D_SIZE {LUT_SIZE})")
    _describe(dst, "target")
    _mixed_look_warning(src_paths, a.threshold)

    cubedir = os.path.abspath(os.path.expanduser(a.cubedir))
    os.makedirs(cubedir, exist_ok=True)
    manifest_path = a.manifest or os.path.join(cubedir, "manifest.json")

    entries, skipped = [], 0
    for p in src_paths:
        src = image_stats(p)
        if not src:
            skipped += 1; continue
        rel = os.path.relpath(p, root)
        stem = os.path.splitext(rel)[0]
        cube = os.path.join(cubedir, stem + ".cube")
        os.makedirs(os.path.dirname(cube), exist_ok=True)
        with open(cube, "w") as f:
            f.write(bake_normalize(src, dst, a.strength, f"normalize::{stem}", a.method))
        entries.append({"photo": p, "cube": cube, "rel": rel})

    with open(manifest_path, "w") as f:
        json.dump({"root": root, "target": target_label, "strength": a.strength,
                   "entries": entries}, f, ensure_ascii=False, indent=2)
    print(f"  ▸ {len(entries)}장 cube 베이크"
          f"{f' ({skipped}장 스킵)' if skipped else ''}  → {os.path.relpath(cubedir, root) or '.'}/")
    print(f"  ▸ manifest: {manifest_path}")

if __name__ == "__main__":
    main()
