#!/usr/bin/env python3
# photo-lut-tree — treatment 그룹별 *잔차 계층* + *역방향(무보정 추정)* LUT 역추출. claude 0.
#
#   왜(사용자 교정): before/after 가 의미 있으려면 LUT 이 "무보정→브랜드그레이드" 변환이어야 한다.
#       이미 보정된 사진에 forward LUT 을 또 얹으면 after→after(차이 0). 그래서:
#       · base LUT(forward)  = 전 사진 공통 후보정 = 브랜드 베이스 (neutral→brand)
#       · base/treatment INVERSE = 그레이드를 *제거* (사진→추정 무보정). ab 시프트를 음수로 베이크.
#       · treatment 잔차 = base 대비 그 룩에 더해지는 레이어 (core→treatment 도달 루트).
#       체이닝: 무보정추정 = inverse_treatment(원본) → +base → +treatment(≈원본). 3패널로 보임.
#
#   photo-lut.py(톤구간 LAB 서명→.cube) 재사용. 역방향 = 서명 ab 부호 반전 후 동일 bake.
#
#   사용:
#     photo-lut-tree.py <samples 디렉토리> --out <dir> [--manifest _treatments.json] [--strength 0.9]
#   출력: <out>/luts/base.cube · base.inverse.cube · <id>.cube · <id>.inverse.cube · <id>.residual.cube
#         + _lut_tree.json
import os, sys, glob, json, re, argparse, importlib.util
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass
from image_formats import PHOTO_EXTS

TOOLS = os.path.dirname(os.path.realpath(__file__))


def _photolut():
    spec = importlib.util.spec_from_file_location("photolut", os.path.join(TOOLS, "photo-lut.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def _imgs(d):
    return [f for f in glob.glob(os.path.join(d, "**", "*"), recursive=True)
            if os.path.isfile(f) and os.path.splitext(f)[1].lower() in PHOTO_EXTS
            and not os.path.basename(f).startswith(".")]


def _neg_sig(sig, pl):
    """서명 ab 부호 반전 → 역방향(그레이드 제거) bake 용 pseudo-sig."""
    return {z: (sig[z][0], -sig[z][1], -sig[z][2]) for z in pl.ZONES if sig.get(z)}


def _delta_sig(child, parent, pl):
    out = {}
    for z in pl.ZONES:
        c, p = child.get(z), parent.get(z)
        if c and p:
            out[z] = (0.0, c[1] - p[1], c[2] - p[2])
        elif c:
            out[z] = (0.0, c[1], c[2])
    return out


def _delta_words(child, parent, pl):
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
    return out or ["≈base"]


def _sig_json(sig, pl):
    return {z: ([round(x, 1) for x in sig[z]] if sig.get(z) else None) for z in pl.ZONES}


def main():
    ap = argparse.ArgumentParser(description="treatment 그룹 → base+inverse+잔차 계층 LUT")
    ap.add_argument("samples", help="samples 디렉토리 (하위=그룹별 폴더)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", default=None, help="_treatments.json (id/ko/describe 매핑)")
    ap.add_argument("--strength", type=float, default=0.9)
    ap.add_argument("--nest-threshold", type=float, default=14.0)
    a = ap.parse_args()
    pl = _photolut()

    samples = os.path.abspath(os.path.expanduser(a.samples))
    cdirs = sorted(d for d in glob.glob(os.path.join(samples, "*")) if os.path.isdir(d))
    if not cdirs:
        print(f"그룹 폴더 없음: {samples}"); sys.exit(1)
    # 매니페스트로 dir→{id,ko,describe} 매핑 (없으면 basename)
    meta = {}
    if a.manifest and os.path.exists(a.manifest):
        man = json.load(open(a.manifest, encoding="utf-8"))
        for g in man.get("groups", []):
            meta[os.path.basename(g.get("dir", ""))] = g
    lut_dir = os.path.join(a.out, "luts"); os.makedirs(lut_dir, exist_ok=True)

    groups, all_sigs = [], []
    for cd in cdirs:
        bn = os.path.basename(cd)
        gm = meta.get(bn, {})
        gid = gm.get("id") or re.sub(r"^\d+_", "", bn) or bn
        items = [(p, pl.grading_signature(p)) for p in _imgs(cd)]
        items = [(p, s) for p, s in items if s]
        if not items:
            continue
        sig = pl.average_signatures([s for _, s in items])
        groups.append({"id": gid, "ko": gm.get("describe", gid), "n": len(items),
                       "sig": sig, "items": items, "dir": gm.get("dir", f"treatment_samples/{bn}")})
        all_sigs += [s for _, s in items]
    base = pl.average_signatures(all_sigs)

    # base forward + inverse
    open(os.path.join(lut_dir, "base.cube"), "w").write(pl.bake_cube(base, "base", a.strength))
    open(os.path.join(lut_dir, "base.inverse.cube"), "w").write(
        pl.bake_cube(base, "base inverse (neutralize)", a.strength, invert=True))

    tree = {"base": {"cube": "luts/base.cube", "inverse_cube": "luts/base.inverse.cube",
                     "signature": _sig_json(base, pl), "describe": pl.describe(base)},
            "treatments": []}
    print(f"[lut-tree] base ({len(all_sigs)}장) + {len(groups)}개 treatment")
    print("BASE:\n" + pl.describe(base))

    for g in groups:
        gid, sig = g["id"], g["sig"]
        open(os.path.join(lut_dir, f"{gid}.cube"), "w").write(pl.bake_cube(sig, gid, a.strength))
        open(os.path.join(lut_dir, f"{gid}.inverse.cube"), "w").write(
            pl.bake_cube(sig, f"{gid} inverse", a.strength, invert=True))
        open(os.path.join(lut_dir, f"{gid}.residual.cube"), "w").write(
            pl.bake_cube(_delta_sig(sig, base, pl), f"{gid} residual on base", a.strength))
        node = {"id": gid, "ko": g["ko"], "n": g["n"], "dir": g["dir"],
                "cube": f"luts/{gid}.cube", "inverse_cube": f"luts/{gid}.inverse.cube",
                "residual_cube": f"luts/{gid}.residual.cube",
                "signature": _sig_json(sig, pl), "describe": pl.describe(sig),
                "delta_from_base": _delta_words(sig, base, pl), "subs": []}
        subs = [s for s in pl.cluster_signatures(g["items"], a.nest_threshold) if len(s) >= 4]
        if len(subs) > 1:
            subs.sort(key=len, reverse=True)
            for si, grp in enumerate(subs, 1):
                ssig = pl.average_signatures([s for _, s in grp])
                node["subs"].append({"id": f"{gid}.sub{si}", "n": len(grp),
                                     "delta_from_treatment": _delta_words(ssig, sig, pl)})
        print(f"  {gid:6} n={g['n']:3}  Δbase: {', '.join(node['delta_from_base'])}"
              + (f"  +{len(node['subs'])}sub" if node["subs"] else ""))
        tree["treatments"].append(node)

    json.dump(tree, open(os.path.join(a.out, "_lut_tree.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"\n✓ luts/ (base+inverse + {len(groups)} treatment) + _lut_tree.json")


if __name__ == "__main__":
    main()
