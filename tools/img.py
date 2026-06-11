#!/usr/bin/env python3
# door: image    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
# img — 로컬 이미지 폴더 처리 단일 front door (workerCtl / brandRe / framer 패턴).
#
# 정신: 그룹 없이 ~/bin 에 우수수 떠돌던 image-*/photo-* 도구들을 동사 하나로 모은다.
#   내부 모듈(image-tagger.py·photo-cluster.py 등)은 그대로 두고, 사용자는 `img` 에서
#   verb 만 고른다 — 얇은 라우터, 모듈성 유지 (CLAUDE.md framer 절 / reuse-first 스킬).
#
#   정리 (design-recon / 브랜드 레퍼런스 파이프라인 + 폴더 위생):
#     img deframe   가장자리 단색 패딩 띠(프레이밍) 감지 → 격리/삭제
#     img dedup     화질 다른 중복 → 최대 해상도만 남김
#     img tag       비전 분류 → Finder 태그 + _tags.json
#     img convert   이미지 형식 변환 any→any (webp 기본, --to heic/jpg/png/avif…)
#     img cluster   사진 더미 → 시각 패턴 클러스터 → 층화 대표 추출
#     img pattern   _tags.json → 브랜드 사진 체계(아키타입·조합문법) 분석
#     img grade     브랜드 사진의 컬러그레이딩을 .cube LUT 로 역추출 (photo-lut)
#     img ref-fetch 브랜드 진입 페이지 이미지 레퍼런스 수집 → webp
#     img help
#
#   재귀: 모든 폴더 verb 는 기본 하위 폴더까지 (재귀). top-level 만 하려면 -R / --no-recurse.
#     진입점 단일 규칙 — verb 마다 -r 이 먹고 안 먹고 제각각이던 것을 img 에서 일괄 정규화한다.
#
#   ※ lut(적용)·brandRe 는 이미 자체 front door 라 여기 흡수 안 함 (떠돌이가 아님).
#     img grade 는 그 반대(추출)라 lut(적용) 명령과 헷갈리지 않게 grade 로 명명.
import os, sys, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경(OCI 등)에서도 동작하게 선택적)
except ImportError:
    pass

TOOLS = os.path.dirname(os.path.realpath(__file__))
REPO = os.path.dirname(TOOLS)
VENV_PY = os.path.join(REPO, "webExporter", ".venv", "bin", "python")  # numpy/Pillow 가 있는 venv


def _py():
    """내부 모듈은 numpy/Pillow 가 필요 — webExporter venv 우선, 없으면 현재 인터프리터."""
    return VENV_PY if os.path.exists(VENV_PY) else sys.executable


# ── verb 정의 (단일 출처) ──────────────────────────────────────────────────
# 한 곳에서 라우팅·help·대화형 메뉴를 전부 derive (DRY — workerCtl 의 함수 테이블 정신).
#   key      : 사용자가 치는 동사
#   module   : tools/ 안 위임 대상 (얇은 라우터라 모듈은 안 움직임)
#   interp   : 'py'(venv 파이썬) | 'swift'
#   needs    : 'folder'(폴더 경로 1개) | 'none'(브랜드 필터 등 자유 인자)
#   summary  : 한 줄 설명 (help·대화형 공통)
#   recurse  : 하위 폴더까지 처리하는가 (True=폴더 verb 공통 재귀 규칙 대상).
#              pattern(_tags.json 분석)·ref-fetch(폴더 아님)만 False — 재귀 개념이 없다.
VERBS = [
    ("deframe",   "image-filter-graphic-frame.py", "py",    "folder", "가장자리 단색 패딩 띠(레터박스·흰여백·텍스트카드 배경) 프레이밍 감지 → 격리/삭제", True),
    ("dedup",     "image-dedup.py",                "py",    "folder", "화질 다른 중복(같은 사진 다른 해상도) → 최대 해상도(고해상)만 남김", True),
    ("tag",       "image-tagger.py",               "py",    "folder", "비전 모델로 피사체·톤·후보정·구도 분류 → Finder 태그 + _tags.json (비파괴)", True),
    ("convert",   "image-convert.py",              "py",    "folder", "이미지 형식 변환 any→any. --to webp(기본)/heic/jpg/png/avif… 병렬·비파괴", True),
    ("cluster",   "photo-cluster.py",              "py",    "folder", "사진 더미(수천 장) → 시각 패턴 클러스터 → 층화 대표만 추출 (오프라인·무료)", True),
    ("pattern",   "photo-pattern.py",              "py",    "folder", "_tags.json → 브랜드 사진 '체계'(아키타입·피사체별 고정축·조합 문법) 분석", False),
    ("grade",     "photo-lut.py",                  "py",    "folder", "브랜드 사진의 컬러그레이딩을 .cube 3D LUT 로 역추출 (design-recon)", True),
    ("ref-fetch", "image-ref-fetch.py",            "py",    "none",   "브랜드 진입 페이지 이미지 레퍼런스 수집 → webp (image-ref-brands.csv)", False),
]
SPEC = {v[0]: v for v in VERBS}

# 재귀 플래그 표준 — 어느 폴더 verb 에서든 똑같이 받는다 (진입점 단일 규칙, verb 별 제각각 폐기).
#   -r/--recursive : 재귀(=기본). 이미 기본이라 흡수만 — 사용자가 명시로 쳐도 안전하게 동작.
#   -R/--no-recurse: top-level 만. 모듈이 아는 단일 방언(--no-recurse)으로 번역해 위임.
RECURSE_ON  = {"-r", "--recursive"}
RECURSE_OFF = {"-R", "--no-recurse"}


def _run(module, rest, interp="py"):
    """위임 실행 — interp 별 인터프리터로 tools/<module> 호출 후 returncode 전달."""
    if interp == "swift":
        return subprocess.run(["swift", os.path.join(TOOLS, module)] + rest).returncode
    return subprocess.run([_py(), os.path.join(TOOLS, module)] + rest).returncode


def _apply_recurse(verb, rest):
    """폴더 verb 공통 재귀 규칙을 진입점에서 일괄 정규화 (verb 마다 제각각이던 처리를 한 곳으로).
    어느 verb 든 -r/--recursive(재귀=기본) · -R/--no-recurse(top-level) 를 똑같이 받아
    모듈이 아는 단일 방언(--no-recurse)으로 번역. 재귀 미지원 verb(pattern·ref-fetch)는
    재귀 플래그를 조용히 흡수 — 실수로 줘도 '알 수 없는 인자' 에러로 죽지 않게."""
    flags = RECURSE_ON | RECURSE_OFF
    if not SPEC[verb][5]:                       # recurse 미지원 → 재귀 플래그만 걷어냄
        return [a for a in rest if a not in flags]
    off = any(a in RECURSE_OFF for a in rest)   # -R/--no-recurse 가 하나라도 있으면 top-level
    kept = [a for a in rest if a not in flags]  # -r/--recursive 는 흡수(이미 기본이 재귀)
    return kept + (["--no-recurse"] if off else [])


def dispatch(verb, rest):
    _, module, interp, _needs, _summary, _recurse = SPEC[verb]
    return _run(module, _apply_recurse(verb, rest), interp)


# deframe/dedup 은 대화형에서 미리보기→확인 플로가 따로 있어 이름 있는 헬퍼로 둔다.
def cmd_deframe(rest):
    return _run("image-filter-graphic-frame.py", rest)


def cmd_dedup(rest):
    return _run("image-dedup.py", rest)


def _build_help():
    rows = [f"  img {v[0]:<10}{v[4]}" for v in VERBS]
    return (
        "img — 로컬 이미지 폴더 처리 (단일 front door)\n\n"
        + "\n".join(rows)
        + "\n\n  img help\n\n"
        "  • 폴더 verb 는 기본 하위 폴더까지 (재귀). top-level 만:  -R  또는  --no-recurse\n"
        "      예)  img dedup ~/refs       # 하위 폴더 전부 (기본)\n"
        "           img dedup -R ~/refs    # 맨 위 폴더만\n"
        "  • 대부분 argparse — 상세 옵션은  img <verb> --help  (예: img convert --help)\n"
        "  • 비파괴: tag·convert·cluster·pattern·grade 는 원본을 안 건드림\n"
        "  • lut(적용)·brandRe 는 별도 front door (img 흡수 대상 아님)"
    )


HELP = _build_help()


def _tty():
    """대화형 가능 환경인가 (파이프·자동화면 False → HELP 출력, 입력 안 막음)."""
    return sys.stdin.isatty() and sys.stdout.isatty()


def _ask(q):
    try:
        return input(q).strip()
    except (EOFError, KeyboardInterrupt):
        print("\n취소")
        sys.exit(0)


def _ask_folder(prompt="이미지 폴더 경로 (Finder 에서 끌어다 놓아도 됨): "):
    raw = _ask(prompt)
    if not raw:
        print("취소")
        return None
    folder = os.path.expanduser(raw.strip().strip("'\"").rstrip("/"))
    if not os.path.isdir(folder):
        sys.exit(f"폴더 없음: {folder}")
    return folder


def _ask_recurse(verb):
    """폴더 verb 공통 — 하위 폴더 포함 여부 (기본 재귀). 재귀 미지원 verb 는 묻지 않음.
    반환은 rest 에 그대로 더할 인자 (재귀=[], top-level=['--no-recurse'])."""
    if not SPEC[verb][5]:
        return []
    ans = _ask("하위 폴더까지 전부? (재귀) [Y/n]: ").lower()
    return ["--no-recurse"] if ans in ("n", "no") else []


def interactive():
    """img (인자 없이) — 안내형 (workerCtl 패턴): verb 메뉴 → 폴더 → 실행.
    각 단계는 dispatch/cmd_* 를 그대로 호출 (reuse-first — wizard 는 얇은 오케스트레이터)."""
    print("═══ img ═══  로컬 이미지 폴더 처리  (Ctrl-C 종료)\n")
    print("무엇을 할까요?")
    for i, v in enumerate(VERBS, 1):
        print(f"  {i:>2}) {v[0]:<10}{v[4]}")
    sel = _ask(f"\n선택 (1-{len(VERBS)}): ")
    if not sel.isdigit() or not (1 <= int(sel) <= len(VERBS)):
        print("취소")
        return 0
    verb = VERBS[int(sel) - 1][0]

    # 파괴적 동작은 미리보기→확인 플로 (되돌리기 보호). 재귀 여부는 미리보기 전에 확정해
    # 미리보기 장수 = 실제 처리 장수 가 일치하게 한다.
    if verb == "deframe":
        folder = _ask_folder()
        return _i_deframe(folder, _ask_recurse("deframe")) if folder else 0
    if verb == "dedup":
        folder = _ask_folder()
        return _i_dedup(folder, _ask_recurse("dedup")) if folder else 0

    # ref-fetch 는 폴더가 아니라 브랜드 필터(선택) — 비우면 전체
    if verb == "ref-fetch":
        flt = _ask("브랜드 이름 필터 (공백구분, 비우면 전체): ")
        return dispatch("ref-fetch", flt.split())

    # 나머지(비파괴 분석/변환): 폴더만 받아 기본값으로 실행
    folder = _ask_folder()
    if not folder:
        return 0
    rest = [folder]
    if verb == "cluster":
        # cluster 는 --out 필수 → 폴더 안 _cluster 로 기본값
        rest += ["--out", os.path.join(folder, "_cluster")]
    elif verb == "convert":
        # any→any: 타겟 형식 선택 (비우면 webp)
        fmt = _ask("타겟 형식 (webp[기본]·heic·jpg·png·avif·tiff): ").lower().lstrip(".")
        if fmt:
            rest += ["--to", fmt]
    rest += _ask_recurse(verb)   # 폴더 verb 공통 재귀 토글 (pattern 은 미지원 → 안 물음)
    print(f"\n▶ img {verb} 실행 …\n", flush=True)
    return dispatch(verb, rest)


def _i_deframe(folder, rflags):
    # ① 자동 미리보기 (dry-run) — 실제 변경 전에 몇 장 잡히는지 먼저 보여준다
    print("\n▶ 미리보기 (실제 변경 없음) …\n", flush=True)  # subprocess 출력보다 먼저 나오게 flush
    cmd_deframe([folder] + rflags)
    # ② 모드 선택
    print("\n어떻게 할까요?")
    print("  1) 격리 폴더로 이동  (검수용, 되돌리기 쉬움)")
    print("  2) 삭제")
    print("  3) 취소")
    choice = _ask("선택 (1-3): ")
    if choice == "1":
        dest = os.path.join(folder, "_graphic_frames")
        rc = cmd_deframe([folder, "--move-to", dest] + rflags)
        print(f"\n격리 완료 → {dest}")
        subprocess.run(["open", dest], check=False)  # macOS — 검수용으로 폴더 열기
        return rc
    if choice == "2":
        if _ask("정말 삭제합니다. 되돌릴 수 없습니다. 'yes' 입력: ") == "yes":
            return cmd_deframe([folder, "--delete"] + rflags)
        print("취소")
        return 0
    print("취소")
    return 0


def _i_dedup(folder, rflags):
    # dedup 은 격리(move) 없이 삭제만 — 미리보기(--dry) → 삭제 확인
    print("\n▶ 미리보기 (삭제 안 함) …\n", flush=True)
    cmd_dedup([folder, "--dry"] + rflags)
    print("\n가장 큰 픽셀(고해상)만 남기고 나머지 중복을 삭제할까요? (되돌릴 수 없음)")
    if _ask("삭제하려면 'yes' 입력: ") == "yes":
        return cmd_dedup([folder] + rflags)
    print("취소")
    return 0


def main():
    args = sys.argv[1:]
    if not args:
        # workerCtl 처럼: TTY 면 대화형, 비-TTY(파이프·자동화)면 HELP (입력 안 막음)
        if _tty():
            sys.exit(interactive() or 0)
        print(HELP)
        return
    if args[0] in ("help", "-h", "--help"):
        print(HELP)
        return
    verb, rest = args[0], args[1:]
    if verb in SPEC:
        sys.exit(dispatch(verb, rest) or 0)
    sys.exit(f"알 수 없는 명령: {verb}\n  img help 로 사용법 확인")


if __name__ == "__main__":
    main()
