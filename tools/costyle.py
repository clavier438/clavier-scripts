#!/usr/bin/env python3
# door: image    # ← scripts 브리핑 자기등록 (SSOT=이 줄).
# costyle — Capture One .costyle 스타일 세트 도구 (브랜드 사진 톤 아키텍쳐 구현 front door).
#
# 정신: brandRe / img 와 같은 "단일 front door + verb" 패턴. 시네마/사진 업계의 레이어형
#   그레이딩 아키텍쳐(BASE 컬러 / mood HDR / Util trim)를 .costyle 세트로 굽는다.
#   레퍼런스·원칙 = skills/brand-tone-architecture/ (grading-architecture / costyle-format /
#   authoritative-samples). 핵심 = ★ 레이어 호환 키만 굽는다 (WB 등 배경 전용은 구조적 차단).
#
#   costyle make [preset] [--out DIR]   레이어 호환 스타일 세트 생성 (기본 preset=mukayu,
#                                       기본 DIR=Capture One Styles). BASE/Indoor/Outdoor/Util.
#   costyle reverse <photodir> [-o c]   사진셋 → .cube 3D LUT 역추출 (photo-lut 재사용)
#   costyle split <src.costyle>         레이어형 스타일 1개 → 책임별(컬러/HDR/trim) 분리 파일
#   costyle keys [<key>]                검증된 .costyle 키 사전 출력 (추측 금지 backbone)
#   costyle help
#
# CO 라이브 검증(2026-06-13): 레이어형(Engine 1300)은 조정 레이어로 정확 적용. WhiteBalance 는
#   레이어에서 드롭 = 배경 전용 → 이 도구는 BACKGROUND_ONLY 키를 emit 거부(경고). 상세 = costyle-format.md.
import os, sys, json, uuid, glob, subprocess

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 모든 .py tool 첫 import, 없는 환경도 동작)
except ImportError:
    pass

TOOLS = os.path.dirname(os.path.realpath(__file__))
REPO = os.path.dirname(TOOLS)
PHOTO_LUT = os.path.join(TOOLS, "photo-lut.py")
VENV_PY = os.path.join(REPO, "webExporter", ".venv", "bin", "python")
CO_STYLES = os.path.expanduser("~/Library/Application Support/Capture One/Styles")


def _c(code, s): return f"\033[{code}m{s}\033[0m" if sys.stdout.isatty() else s
def bold(s): return _c("1", s)
def warn(s): return _c("33", s)
def ok(s): return _c("32", s)

# ── 키 분류 (costyle-format.md ★ 섹션 = CO 라이브 검증) ───────────────────────
# 배경 전용: 레이어 <LA> 에 넣으면 CO 가 조용히 드롭. 굽지 않는다(구조적 차단).
BACKGROUND_ONLY = {
    "WhiteBalanceTemperature", "WhiteBalanceTint", "ICCProfile", "FilmCurve",
}
# 레이어 호환(검증/관측된 키). 값 포맷 메모.
LAYER_COMPATIBLE = {
    "ColorBalanceShadow": "R;G;B 배율(1.0 근방)", "ColorBalanceMidtone": "R;G;B",
    "ColorBalanceHighlight": "R;G;B", "ColorBalance": "R;G;B 마스터",
    "ColorCorrections": "색역당 18값, ; 구분 (Color Editor)",
    "Contrast": "float", "Saturation": "int", "Brightness": "float", "Exposure": "EV float",
    "GradationCurve": "x,y;… (0~1)", "GradationCurveRed": "x,y;…",
    "GradationCurveGreen": "x,y;…", "GradationCurveBlue": "x,y;…", "GradationCurveY": "x,y;…",
    "HighlightRecoveryEx": "-100~100 (음수=누르기)", "ShadowRecovery": "-100~100 (양수=열기)",
    "BlackRecovery": "-100~100", "WhiteRecovery": "-100~100",
    "Clarity": "int", "ClarityStructure": "int", "ClarityMethod": "int(1·2·3)",
    "UsmAmount": "int(샤프닝)", "UsmRadius": "float",
    "Vignetting": "int(-100~100, 음수=어둡게)",
    "FilmGrainAmount": "int", "FilmGrainDensity": "int",
    "FilmGrainGranularity": "int", "FilmGrainType": "int",
}


def write_costyle(out_dir, name, adj, opacity=100):
    """Engine 1300 레이어형 .costyle 1개 작성. BACKGROUND_ONLY 키는 거부(경고)."""
    kept, dropped = {}, []
    for k, v in adj.items():
        if k in BACKGROUND_ONLY:
            dropped.append(k)
        else:
            kept[k] = v
    if dropped:
        print(warn(f"  ⚠ {name}: 배경 전용 키 제외 — {', '.join(dropped)} "
                   f"(레이어에서 드롭됨. 평면 스타일로만 가능)"))
    lines = [f'\t\t\t<E K="{k}" V="{v}" />' for k, v in sorted(kept.items())]
    lines.append(f'\t\t\t<E K="Enabled" V="1" />')
    lines.append(f'\t\t\t<E K="Name" V="{name}" />')
    lines.append(f'\t\t\t<E K="Opacity" V="{opacity}" />')
    body = "\n".join(sorted(lines))
    xml = (f'<?xml version="1.0"?>\n<SL Engine="1300">\n'
           f'\t<E K="Name" V="{name}" />\n\t<E K="UUID" V="{str(uuid.uuid4()).upper()}" />\n</SL>\n'
           f'<LDS>\n\t<LD>\n\t\t<LA>\n{body}\n\t\t</LA>\n'
           f'\t\t<MDS>\n\t\t\t<MD>\n\t\t\t\t<E K="BlendMode" V="0" />\n'
           f'\t\t\t\t<E K="Density" V="1" />\n\t\t\t\t<E K="MaskType" V="1" />\n'
           f'\t\t\t</MD>\n\t\t</MDS>\n\t</LD>\n</LDS>\n')
    path = os.path.join(out_dir, name + ".costyle")
    with open(path, "w", encoding="utf-8") as f:
        f.write(xml)
    return path


# ── presets: 레이어 호환 보정만. 검증된 mukayu 값 (CO 라이브 통과). ──────────────
_MUKAYU_CC = ("1,1,1,0,0,0,255,0,168.909881591797,-7.11462593078613,7.11462593078613,-100,100,15,0,0,0,0;"
    "1,1,1,0,0,0,170.93928527832,0,255,-17.8928756713867,17.8928756713867,-100,100,15,0,0,0,0;"
    "1,1,1,0,0,0,0,64.2907180786133,255,-22.4273700714111,22.4273700714111,-100,100,15,0,0,0,0;"
    "1,1,1,0,0,0,0,255,236.14192199707,-11.8545951843262,11.8545951843262,-100,100,15,0,0,0,0;"
    "1,1,1,-12.8470478057861,14.5740385055542,0.776505708694458,45.498851776123,255,0,-39.3857116699219,39.3857116699219,-100,100,15,0,0,0,0;"
    "1,1,1,0,0,0,255,211.99267578125,0,-5,5,-100,100,15,0,0,0,0;"
    "1,1,1,0.27735498547554,-10.7721223831177,0,255,101.301910400391,0,-6.01692199707031,6.01692199707031,-100,100,15,0,0,0,0;"
    "1,1,1,0,0,0,255,0,31.4708557128906,-10.195873260498,10.195873260498,-100,100,15,0,0,0,0;"
    "0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0")

PRESETS = {
    # (레이어이름, opacity, {보정})  — 각각 별도 .costyle 파일, 적용 시 레이어로 스택
    "mukayu": [
        ("BASE_Mukayu_Core", 100, {
            "ColorBalanceHighlight": "0.989852011203766;0.975214958190918;0.955368220806122",
            "ColorBalanceMidtone": "1;0.999489903450012;0.995329797267914",
            "ColorBalanceShadow": "0.990159809589386;1.00495970249176;1.01882183551788",
            "ColorCorrections": _MUKAYU_CC,
            "Contrast": "-3.59320378303528", "Exposure": "0.31265726685524",
            "GradationCurve": "0,0;0.251086056232452,0.248464465141296;0.49879401922226,0.499511152505875;0.762673795223236,0.754079401493073;1,1",
            "GradationCurveGreen": "0,0;0.250402539968491,0.243293225765228;0.5040083527565,0.497048169374466;0.754379749298096,0.750803649425507;1,1",
            "GradationCurveY": "0,0.0511840805411339;0.247548192739487,0.237064242362976;0.503437340259552,0.492444425821304;0.749242842197418,0.74403303861618;1,1",
        }),
        ("Indoor_Base", 100, {
            "HighlightRecoveryEx": "-90", "ShadowRecovery": "85",
            "BlackRecovery": "-95", "WhiteRecovery": "-100"}),
        ("Outdoor_Variant", 100, {
            "HighlightRecoveryEx": "-20", "ShadowRecovery": "40",
            "BlackRecovery": "-40", "WhiteRecovery": "-10"}),
        ("Util", 100, {
            "Clarity": "30", "ClarityStructure": "25", "ClarityMethod": "2",
            "UsmAmount": "180", "UsmRadius": "1", "Vignetting": "-45",
            "FilmGrainAmount": "20", "FilmGrainType": "2",
            "FilmGrainGranularity": "50", "FilmGrainDensity": "0"}),
    ],
}

# split: 레이어형 스타일 1개의 키를 책임별로 분리할 때의 그룹
SPLIT_GROUPS = {
    "Color": {"ColorBalanceShadow", "ColorBalanceMidtone", "ColorBalanceHighlight",
              "ColorBalance", "ColorCorrections", "Saturation",
              "GradationCurve", "GradationCurveRed", "GradationCurveGreen",
              "GradationCurveBlue", "GradationCurveY"},
    "Tone": {"HighlightRecoveryEx", "ShadowRecovery", "BlackRecovery", "WhiteRecovery",
             "Contrast", "Exposure", "Brightness"},
    "Trim": {"Clarity", "ClarityStructure", "ClarityMethod", "UsmAmount", "UsmRadius",
             "Vignetting", "FilmGrainAmount", "FilmGrainDensity",
             "FilmGrainGranularity", "FilmGrainType"},
}


def _parse_layer_adj(path):
    """레이어형 .costyle 의 <LA> 안 K/V 읽기 (Name/Opacity/Enabled 제외)."""
    import re
    txt = open(path, encoding="utf-8").read()
    la = re.search(r"<LA>(.*?)</LA>", txt, re.S)
    seg = la.group(1) if la else txt
    adj = {}
    for k, v in re.findall(r'<E K="([^"]+)" V="([^"]*)" />', seg):
        if k not in ("Name", "Opacity", "Enabled", "UUID"):
            adj[k] = v
    return adj


def cmd_make(args):
    preset = args[0] if args and not args[0].startswith("-") else "mukayu"
    out = CO_STYLES
    if "--out" in args:
        out = os.path.expanduser(args[args.index("--out") + 1])
    if preset not in PRESETS:
        print(f"모르는 preset: {preset}. 가능: {', '.join(PRESETS)}"); sys.exit(1)
    os.makedirs(out, exist_ok=True)
    print(bold(f"costyle make {preset} → {out}"))
    for name, opa, adj in PRESETS[preset]:
        p = write_costyle(out, name, adj, opa)
        print(ok(f"  ✓ {os.path.basename(p)}  ({len(adj)} 보정, opacity {opa})"))
    print("\nCapture One 재시작/새로고침 → User Styles 에 표시. 레이어로 스택 + opacity 조절.")


def cmd_reverse(args):
    if not args:
        print("사용: costyle reverse <photodir> [-o out.cube]"); sys.exit(1)
    py = VENV_PY if os.path.exists(VENV_PY) else sys.executable
    print(bold(f"costyle reverse → photo-lut (사진셋 → .cube)"))
    subprocess.run([py, PHOTO_LUT] + args)


def cmd_split(args):
    if not args:
        print("사용: costyle split <src.costyle>"); sys.exit(1)
    src = os.path.expanduser(args[0])
    adj = _parse_layer_adj(src)
    base = os.path.splitext(os.path.basename(src))[0]
    out = os.path.dirname(os.path.abspath(src))
    print(bold(f"costyle split {os.path.basename(src)} → 책임별 분리"))
    made = 0
    for grp, keys in SPLIT_GROUPS.items():
        sub = {k: v for k, v in adj.items() if k in keys}
        if sub:
            p = write_costyle(out, f"{base}_{grp}", sub, 100)
            print(ok(f"  ✓ {os.path.basename(p)}  ({', '.join(sub)})")); made += 1
    leftover = [k for k in adj if not any(k in g for g in SPLIT_GROUPS.values())]
    if leftover:
        print(warn(f"  분류 안 된 키: {', '.join(leftover)}"))
    if not made:
        print("분리할 레이어 호환 보정이 없음.")


def cmd_keys(args):
    if args:
        k = args[0]
        if k in BACKGROUND_ONLY:
            print(warn(f"{k} — ⚠ 배경 전용. 레이어 스타일에 넣으면 드롭. 평면 스타일로만."))
        elif k in LAYER_COMPATIBLE:
            print(ok(f"{k} — 레이어 호환. 값: {LAYER_COMPATIBLE[k]}"))
        else:
            print(f"{k} — 검증 사전에 없음. 실물 export 또는 "
                  f"`gh api search/code \"{k} extension:costyle\"` 로 확인 후 사용 (추측 금지).")
        return
    print(bold("검증된 .costyle 키 사전 (레이어 호환)"))
    for k, fmt in sorted(LAYER_COMPATIBLE.items()):
        print(f"  {k:<22} {fmt}")
    print(bold("\n배경 전용 (레이어에서 드롭 — 굽지 않음)"))
    for k in sorted(BACKGROUND_ONLY):
        print(warn(f"  {k}"))
    print("\n상세·작성규칙 = skills/brand-tone-architecture/references/costyle-format.md")


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("help", "-h", "--help"):
        print(__doc__ if False else
              "costyle — Capture One 스타일 세트 도구\n\n"
              "  costyle make [preset] [--out DIR]   레이어 호환 세트 생성 (기본 mukayu → CO Styles)\n"
              "  costyle reverse <photodir> [-o c]   사진셋 → .cube LUT (photo-lut)\n"
              "  costyle split <src.costyle>         레이어 스타일 → 컬러/HDR/trim 분리\n"
              "  costyle keys [<key>]                검증된 키 사전 (추측 금지)\n"
              "  costyle help\n\n"
              "원칙: 레이어 호환 키만 굽는다 (WB 등 배경 전용은 구조적 차단). "
              "skills/brand-tone-architecture/.")
        return
    verb, rest = sys.argv[1], sys.argv[2:]
    {"make": cmd_make, "reverse": cmd_reverse, "split": cmd_split, "keys": cmd_keys}.get(
        verb, lambda a: print(f"모르는 verb: {verb} (costyle help)"))(rest)


if __name__ == "__main__":
    main()
