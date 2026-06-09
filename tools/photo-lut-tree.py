#!/usr/bin/env python3
# photo-lut-tree — 컨셉 그룹별 사진에서 *잔차 계층* 컬러그레이딩 LUT 을 역추출. claude 0.
#
#   왜(사용자): 브랜드는 사진 그레이딩을 계층으로 관리한다 — 브랜드 코어 LUT 을 공통 적용하고,
#       미니컨셉마다 다른 LUT 을 그 위에 얹고, 그 안에서 또 갈리는 것은 중첩(nested)으로 쌓는다.
#       이 아키텍처를 그대로 재현: core(전체 평균) → concept(코어 대비 *delta*) → sub(컨셉 대비 delta).
#       체이닝(core→concept→sub)하면 원래 그레이드 복원. delta 수치가 "그 층이 더한 것"의 정체.
#
#   photo-lut.py(톤구간별 LAB 서명 → .cube) 를 모듈로 재사용 (reuse-first). 잔차는 ab 시프트를
#       (concept - core) 로 베이크한 .cube — 코어 뒤에 얹으면 합쳐져 컨셉이 된다.
#
#   사용:
#     photo-lut-tree.py <concept_samples 디렉토리> --out <dir> [--strength 0.9] [--nest-threshold 14]
#   입력: <samples>/<NN_concept>/  (photo-clip concepts 가 만든 컨셉별 대표 폴더)
#   출력: <out>/luts/core.cube · <concept>.cube(절대) · <concept>.residual.cube · sub… + _lut_tree.json
import os, sys, glob, json, re, argparse, importlib.util
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass
from image_formats import PHOTO_EXTS

TOOLS = os.path.dirname(os.path.realpath(__file__))


def _load_photolut():
    """하이픈 파일명이라 일반 import 불가 — 경로로 로드해 함수 재사용."""
    spec = importlib.util.spec_from_file_location("photolut", os.path.join(TOOLS, "photo-lut.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def _imgs(d):
    return [f for f in glob.glob(os.path.join(d, "**", "*"), recursive=True)
            if os.path.isfile(f) and os.path.splitext(f)[1].lower() in PHOTO_EXTS
            and not os.path.basename(f).startswith(".")]


def _delta_sig(child, parent, pl):
    """child·parent 서명(zone→(L,a,b)) → 잔차 pseudo-sig (ab 차이, L 은 anchor 가 무시)."""
    out = {}
    for z in pl.ZONES:
        c, p = child.get(z), parent.get(z)
        if c and p:
            out[z] = (0.0, c[1] - p[1], c[2] - p[2])
        elif c:
            out[z] = (0.0, c[1], c[2])
    return out


def _delta_words(child, parent, pl):
    """잔차를 사람 말로: 구간별 ab 시프트 방향."""
    out = []
    for z in pl.ZONES:
        c, p = child.get(z), parent.get(z)
        if not (c and p):
            continue
        da, db = c[1] - p[1], c[2] - p[2]
        if abs(da) < 1.5 and abs(db) < 1.5:
            continue
        warm = "웜+" if db > 1.5 else "쿨+" if db < -1.5 else ""
        mag = "마젠타+" if da > 1.5 else "그린+" if da < -1.5 else ""
        out.append(f"{z}:{warm}{mag}(a{da:+.1f} b{db:+.1f})")
    return out or ["≈core"]


def main():
    ap = argparse.ArgumentParser(description="컨셉 그룹 → 잔차 계층 LUT (core→concept→sub)")
    ap.add_argument("samples", help="concept_samples 디렉토리 (하위=컨셉별 폴더)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--strength", type=float, default=0.9)
    ap.add_argument("--nest-threshold", type=float, default=14.0, help="컨셉 내 sub 분리 색거리(작을수록 잘게)")
    a = ap.parse_args()
    pl = _load_photolut()

    samples = os.path.abspath(os.path.expanduser(a.samples))
    cdirs = sorted(d for d in glob.glob(os.path.join(samples, "*")) if os.path.isdir(d))
    if not cdirs:
        print(f"컨셉 폴더 없음: {samples}"); sys.exit(1)
    lut_dir = os.path.join(a.out, "luts"); os.makedirs(lut_dir, exist_ok=True)

    # 1) 컨셉별 서명 + 전체(core) 서명
    concepts, all_sigs = [], []
    for cd in cdirs:
        items = [(p, pl.grading_signature(p)) for p in _imgs(cd)]
        items = [(p, s) for p, s in items if s]
        if not items:
            continue
        sig = pl.average_signatures([s for _, s in items])
        cid = re.sub(r"^\d+_", "", os.path.basename(cd))   # 'NN_<id>' → '<id>' (concepts.json 과 매칭)
        concepts.append({"id": cid, "n": len(items), "sig": sig, "items": items})
        all_sigs += [s for _, s in items]
    core = pl.average_signatures(all_sigs)
    with open(os.path.join(lut_dir, "core.cube"), "w") as f:
        f.write(pl.bake_cube(core, "core", a.strength))

    tree = {"core": {"cube": "luts/core.cube", "signature": _sig_json(core, pl),
                     "describe": pl.describe(core)}, "concepts": []}
    print(f"[lut-tree] core ({len(all_sigs)}장) + {len(concepts)}개 컨셉")
    print("CORE:\n" + pl.describe(core))

    for c in concepts:
        cid, sig = c["id"], c["sig"]
        # 절대 LUT (before/after 렌더용) + 잔차 LUT (코어 위 스택용)
        with open(os.path.join(lut_dir, f"{cid}.cube"), "w") as f:
            f.write(pl.bake_cube(sig, cid, a.strength))
        with open(os.path.join(lut_dir, f"{cid}.residual.cube"), "w") as f:
            f.write(pl.bake_cube(_delta_sig(sig, core, pl), f"{cid} (residual on core)", a.strength))
        node = {"id": cid, "n": c["n"], "cube": f"luts/{cid}.cube",
                "residual_cube": f"luts/{cid}.residual.cube",
                "signature": _sig_json(sig, pl),
                "delta_from_core": _delta_words(sig, core, pl), "subs": []}
        # 2) nested: 컨셉 내부가 색정책으로 갈리면 sub (컨셉 대비 잔차)
        subgroups = pl.cluster_signatures(c["items"], a.nest_threshold)
        subgroups = [g for g in subgroups if len(g) >= 4]      # 너무 작은 sub 무시
        if len(subgroups) > 1:
            subgroups.sort(key=len, reverse=True)
            for si, grp in enumerate(subgroups, 1):
                ssig = pl.average_signatures([s for _, s in grp])
                sname = f"{cid}.sub{si}"
                with open(os.path.join(lut_dir, f"{sname}.residual.cube"), "w") as f:
                    f.write(pl.bake_cube(_delta_sig(ssig, sig, pl), sname, a.strength))
                node["subs"].append({"id": sname, "n": len(grp),
                                     "residual_cube": f"luts/{sname}.residual.cube",
                                     "delta_from_concept": _delta_words(ssig, sig, pl)})
        print(f"  {cid:22} n={c['n']:3}  Δcore: {', '.join(node['delta_from_core'])}"
              + (f"  +{len(node['subs'])}sub" if node["subs"] else ""))
        tree["concepts"].append(node)

    json.dump(tree, open(os.path.join(a.out, "_lut_tree.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"\n✓ luts/ ({len(concepts)} concept + core) + _lut_tree.json → {a.out}")


def _sig_json(sig, pl):
    return {z: ([round(x, 1) for x in sig[z]] if sig.get(z) else None) for z in pl.ZONES}


if __name__ == "__main__":
    main()
