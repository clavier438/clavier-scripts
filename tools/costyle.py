#!/usr/bin/env python3
# door: image    # ← scripts 브리핑 자기등록 (SSOT=이 줄).
# costyle — Capture One .costyle 스타일 세트 도구 (브랜드 사진 톤 아키텍쳐 구현 front door).
#
# 정신: brandRe / img 와 같은 "단일 front door + verb" 패턴. 시네마/사진 업계의 레이어형
#   그레이딩 아키텍쳐(BASE 컬러 / mood HDR / Util trim)를 .costyle 세트로 굽는다.
#   레퍼런스·원칙 = skills/brand-tone-architecture/ (grading-architecture / costyle-format /
#   authoritative-samples). 핵심 = ★ 레이어 호환 키만 굽는다 (WB 등 배경 전용은 구조적 차단).
#
#   costyle make [preset] [-v N] [--out DIR]  레이어 호환 스타일 세트 생성 (기본 preset=mukayu,
#                                       기본 DIR=Capture One Styles). 버전을 이름(예: mukayu_v03_*)
#                                       + Finder 태그에 박아 재실행 충돌·분간불가 제거. -v 생략 시 자동증분.
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
from assetPaths import brand_dir  # 에셋 SSOT 경로 단일 정의 (하드코딩 0)

TOOLS = os.path.dirname(os.path.realpath(__file__))
REPO = os.path.dirname(TOOLS)
PHOTO_LUT = os.path.join(TOOLS, "photo-lut.py")
VENV_PY = os.path.join(REPO, "webExporter", ".venv", "bin", "python")
CO_STYLES = os.path.expanduser(
    os.environ.get("CLAVIER_CO_STYLES", "~/Library/Application Support/Capture One/Styles"))


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
    # 변주축 = 브랜드 데이터가 결정 (2026-06-14 ~/Desktop/mukayu 115장 분석).
    #   실내/실외 아님 → 무드-다크 vs 밝음-제품. 측정(밝기L/그림자%/따뜻함):
    #   Dark_Mood   = 료리·객실·관내·체험 101장 (L~80, 그림자 45%, 따뜻 +14~+23) — 지배 브랜드룩.
    #   Bright_Product = 스파·어메니티 14장 (L~137, 그림자 18%; 스파=웜·어메니티=쿨 저채도 제품컷).
    # 톤 극단 *크기*는 underdetermined → CO 눈검증 루프(아래 시작값에서 튠). 그린 보강은
    #   ColorCorrections 손작성 비권장 → CO export 캡처로 BASE/Bright 에 주입(눈검증 단계).
    "mukayu": [
        ("BASE_Core", 100, {
            "ColorBalanceHighlight": "0.989852011203766;0.975214958190918;0.955368220806122",
            "ColorBalanceMidtone": "1;0.999489903450012;0.995329797267914",
            "ColorBalanceShadow": "0.990159809589386;1.00495970249176;1.01882183551788",
            "ColorCorrections": _MUKAYU_CC,
            "Contrast": "-3.59320378303528", "Exposure": "0.31265726685524",
            "GradationCurve": "0,0;0.251086056232452,0.248464465141296;0.49879401922226,0.499511152505875;0.762673795223236,0.754079401493073;1,1",
            "GradationCurveGreen": "0,0;0.250402539968491,0.243293225765228;0.5040083527565,0.497048169374466;0.754379749298096,0.750803649425507;1,1",
            "GradationCurveY": "0,0.0511840805411339;0.247548192739487,0.237064242362976;0.503437340259552,0.492444425821304;0.749242842197418,0.74403303861618;1,1",
        }),
        # Dark_Mood: 무드 보존(그림자 과리프트 금지) + 하이라이트 롤오프 + 깊은 블랙. 따뜻함은 BASE.
        ("Dark_Mood", 100, {
            "HighlightRecoveryEx": "-50", "ShadowRecovery": "30",
            "BlackRecovery": "-40", "WhiteRecovery": "-30"}),
        # Bright_Product: 하이키·에어리 — 하이라이트 클린 유지, 그림자 충분히 열기, 블랙 가볍게.
        ("Bright_Product", 100, {
            "HighlightRecoveryEx": "-15", "ShadowRecovery": "50",
            "BlackRecovery": "-10", "WhiteRecovery": "-20"}),
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


def _resolve_version(out, preset, args):
    """세트 버전 결정. -v/--version N 명시 우선, 없으면 out 에서 {preset}_v## 스캔해 +1.
    버전을 이름·파일명에 박아 재실행 충돌(CO 가 ' 1',' 1 1' 붙이던 근본 원인)을 제거한다."""
    for flag in ("-v", "--version"):
        if flag in args:
            try:
                return max(1, int(args[args.index(flag) + 1]))
            except (ValueError, IndexError):
                print(f"잘못된 버전 인자 ({flag}). 정수 필요."); sys.exit(1)
    import re
    pat = re.compile(rf"^{re.escape(preset)}_v(\d+)_")
    seen = [int(m.group(1)) for f in glob.glob(os.path.join(out, f"{preset}_v*_*.costyle"))
            if (m := pat.match(os.path.basename(f)))]
    return (max(seen) + 1) if seen else 1


def _finder_tag(path, tags):
    """macOS Finder 태그 부여 (clavier 기존 바퀴 = `tag` CLI, image-tagger.py 와 동일)."""
    tag_bin = "/opt/homebrew/bin/tag"
    if not os.path.exists(tag_bin):
        return False
    try:
        subprocess.run([tag_bin, "-a", ",".join(tags), path],
                       check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, OSError):
        return False


def _deploy_to_co(brand):
    """SSOT 브랜드 폴더 → CO Styles/<brand>/ 복제 배포 (build artifact, 단방향).
    CO 는 하위폴더를 그룹으로 표시 (검증된 동작). 손편집 안 함 → drift 경로 없음."""
    import shutil
    src = brand_dir(brand)
    dst = os.path.join(CO_STYLES, brand)
    os.makedirs(dst, exist_ok=True)
    n = 0
    for f in glob.glob(os.path.join(src, "*.costyle")):
        d = os.path.join(dst, os.path.basename(f))
        shutil.copy2(f, d)
        _finder_tag(d, [brand])          # CO 사본에도 브랜드 태그 (버전은 파일명에)
        n += 1
    return dst, n


def cmd_make(args):
    preset = args[0] if args and not args[0].startswith("-") else "mukayu"
    if preset not in PRESETS:
        print(f"모르는 preset: {preset}. 가능: {', '.join(PRESETS)}"); sys.exit(1)
    # 기본 출력 = SSOT (iCloud lut/<brand>/). --out 으로 override 가능.
    out = os.path.expanduser(args[args.index("--out") + 1]) if "--out" in args \
        else brand_dir(preset, create=True)
    os.makedirs(out, exist_ok=True)
    ver = _resolve_version(out, preset, args)
    vtag = f"{preset}_v{ver:02d}"          # 태그·이름 공통 버전 식별자
    print(bold(f"costyle make {preset} (버전 {vtag}) → SSOT {out}"))
    tagged = True
    for layer, opa, adj in PRESETS[preset]:
        name = f"{vtag}_{layer}"           # 버전을 이름에 박음 → CO 에서 분간 + 파일명 충돌 0
        p = write_costyle(out, name, adj, opa)
        tagged = _finder_tag(p, [preset, vtag]) and tagged  # 버전을 Finder 태그로도 표시
        print(ok(f"  ✓ {os.path.basename(p)}  ({len(adj)} 보정, opacity {opa})"))
    tagnote = f"Finder 태그: {preset}, {vtag}" if tagged else warn("Finder 태그 실패(`tag` CLI 확인)")
    print(f"\n{tagnote}")
    # SSOT → CO 복제 배포 (--out override 시엔 SSOT 가 아니므로 스킵)
    if "--out" not in args:
        dst, n = _deploy_to_co(preset)
        print(ok(f"CO 배포: {n}개 → {dst} (폴더 그룹 '{preset}')"))
    print("Capture One 재시작/새로고침 → User Styles 의 '" + preset + "' 그룹. 레이어 스택 + opacity 조절.")


def cmd_deploy(args):
    brand = args[0] if args and not args[0].startswith("-") else "mukayu"
    src = brand_dir(brand)
    if not os.path.isdir(src) or not glob.glob(os.path.join(src, "*.costyle")):
        print(f"SSOT 에 {brand} 스타일 없음: {src} (먼저 costyle make {brand})"); sys.exit(1)
    print(bold(f"costyle deploy {brand} — SSOT → CO 복제"))
    dst, n = _deploy_to_co(brand)
    print(ok(f"  ✓ {n}개 → {dst} (폴더 그룹 '{brand}')"))
    print("Capture One 재시작/새로고침 → User Styles 의 '" + brand + "' 그룹.")


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
              "  costyle make [preset] [-v N] [--out DIR]  세트 생성 → SSOT(iCloud) + CO 복제 배포\n"
              "  costyle deploy [brand]              SSOT 브랜드폴더 → CO Styles 재배포 (재생성 없이)\n"
              "  costyle reverse <photodir> [-o c]   사진셋 → .cube LUT (photo-lut)\n"
              "  costyle split <src.costyle>         레이어 스타일 → 컬러/HDR/trim 분리\n"
              "  costyle keys [<key>]                검증된 키 사전 (추측 금지)\n"
              "  costyle help\n\n"
              "에셋 SSOT = iCloud .../asset/img/lut/<brand>/ (env CLAVIER_ASSET_LUT override). "
              "CO 는 복제 배포된 build artifact. 레이어 호환 키만 굽는다(WB 등 배경전용 차단). "
              "skills/brand-tone-architecture/.")
        return
    verb, rest = sys.argv[1], sys.argv[2:]
    {"make": cmd_make, "deploy": cmd_deploy, "reverse": cmd_reverse,
     "split": cmd_split, "keys": cmd_keys}.get(
        verb, lambda a: print(f"모르는 verb: {verb} (costyle help)"))(rest)


if __name__ == "__main__":
    main()
