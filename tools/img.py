#!/usr/bin/env python3
# img — 로컬 이미지 폴더 처리 단일 front door (workerCtl / brandRe / framer 패턴).
#
# 정신: 그룹 없이 ~/bin 에 우수수 떠돌던 image-*/photo-* 도구들을 동사 하나로 모은다.
#   내부 모듈(image-filter-graphic-frame.py 등)은 그대로 두고, 사용자는 `img` 에서
#   verb 만 고른다 — 얇은 라우터, 모듈성 유지 (CLAUDE.md framer 절 / reuse-first 스킬).
#
#   img deframe <folder> [옵션]   그래픽 프레이밍(가장자리 단색 패딩 띠) 감지 → 격리/삭제
#   img dedup   <folder> [--dry]  화질 다른 중복 → 가장 큰 픽셀(고해상)만 남기고 삭제
#   img help
#
# 향후 흡수 예정(현재 독립 ~/bin 도구): tag · convert · cluster · lut · pattern · ref-fetch.
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


def cmd_deframe(rest):
    """가장자리 단색 패딩 띠(레터박스·흰 여백·텍스트 카드 배경)로 프레이밍된 이미지 감지."""
    return subprocess.run([_py(), os.path.join(TOOLS, "image-filter-graphic-frame.py")] + rest).returncode


def cmd_dedup(rest):
    """화질 다른 중복(같은 사진의 다른 해상도)을 가장 큰 픽셀만 남기고 삭제 (dhash 클러스터)."""
    return subprocess.run([_py(), os.path.join(TOOLS, "image-dedup.py")] + rest).returncode


HELP = """img — 로컬 이미지 폴더 처리 (단일 front door)

  img deframe <folder> [옵션]
      가장자리 단색 패딩 띠(레터박스·흰 여백·텍스트 카드 배경)로 프레이밍된
      이미지를 감지. 기본 dry-run (실제 변경 없음).
        --delete         감지된 것 삭제
        --move-to DIR    격리 폴더로 이동 (검수용)
        --tol N          단색 판정 변동 허용 (기본 2)
        --min-band N     그래픽으로 볼 최소 띠 두께 px (기본 31)
        --report PATH    결과 JSON 저장

  img dedup <folder> [--dry]
      화질 다른 중복 사진(같은 사진의 다른 해상도)을 가장 큰 픽셀(고해상)만
      남기고 삭제. dhash 클러스터 → 클러스터당 최대 해상도 1장 보존.
        --dry            미리보기 (삭제 안 함)

  img help

(향후 흡수 예정 — 현재 독립 도구: tag · convert · cluster · lut · pattern · ref-fetch)
"""


def _tty():
    """대화형 가능 환경인가 (파이프·자동화면 False → HELP 출력, 입력 안 막음)."""
    return sys.stdin.isatty() and sys.stdout.isatty()


def _ask(q):
    try:
        return input(q).strip()
    except (EOFError, KeyboardInterrupt):
        print("\n취소")
        sys.exit(0)


def interactive():
    """img (인자 없이) — 안내형 (workerCtl 패턴). verb 선택 → 폴더 → 미리보기 → 실행.
    각 단계는 cmd_* 를 그대로 호출 (reuse-first — wizard 는 얇은 오케스트레이터)."""
    print("═══ img ═══  로컬 이미지 폴더 처리  (Ctrl-C 종료)\n")
    print("무엇을 할까요?")
    print("  1) 그래픽 프레임 제거 (deframe — 레터박스·흰 여백·텍스트 카드 배경)")
    print("  2) 중복 사진 정리 (dedup — 화질 다른 같은 사진은 최대 해상도만)")
    what = _ask("선택 (1-2): ")
    if what not in ("1", "2"):
        print("취소")
        return 0
    raw = _ask("이미지 폴더 경로 (Finder 에서 끌어다 놓아도 됨): ")
    if not raw:
        print("취소")
        return 0
    folder = os.path.expanduser(raw.strip().strip("'\"").rstrip("/"))
    if not os.path.isdir(folder):
        sys.exit(f"폴더 없음: {folder}")
    return _i_deframe(folder) if what == "1" else _i_dedup(folder)


def _i_deframe(folder):
    # ① 자동 미리보기 (dry-run) — 실제 변경 전에 몇 장 잡히는지 먼저 보여준다
    print("\n▶ 미리보기 (실제 변경 없음) …\n", flush=True)  # subprocess 출력보다 먼저 나오게 flush
    cmd_deframe([folder])
    # ② 모드 선택
    print("\n어떻게 할까요?")
    print("  1) 격리 폴더로 이동  (검수용, 되돌리기 쉬움)")
    print("  2) 삭제")
    print("  3) 취소")
    choice = _ask("선택 (1-3): ")
    if choice == "1":
        dest = os.path.join(folder, "_graphic_frames")
        rc = cmd_deframe([folder, "--move-to", dest])
        print(f"\n격리 완료 → {dest}")
        subprocess.run(["open", dest], check=False)  # macOS — 검수용으로 폴더 열기
        return rc
    if choice == "2":
        if _ask("정말 삭제합니다. 되돌릴 수 없습니다. 'yes' 입력: ") == "yes":
            return cmd_deframe([folder, "--delete"])
        print("취소")
        return 0
    print("취소")
    return 0


def _i_dedup(folder):
    # dedup 은 격리(move) 없이 삭제만 — 미리보기(--dry) → 삭제 확인
    print("\n▶ 미리보기 (삭제 안 함) …\n", flush=True)
    cmd_dedup([folder, "--dry"])
    print("\n가장 큰 픽셀(고해상)만 남기고 나머지 중복을 삭제할까요? (되돌릴 수 없음)")
    if _ask("삭제하려면 'yes' 입력: ") == "yes":
        return cmd_dedup([folder])
    print("취소")
    return 0


def main():
    args = sys.argv[1:]
    if not args:
        # workerCtl 처럼: TTY 면 대화형, 비-TTY(파이프·자동화)면 HELP (입력 안 막음)
        if _tty():
            sys.exit(interactive() or 0)
        print(HELP.strip())
        return
    if args[0] in ("help", "-h", "--help"):
        print(HELP.strip())
        return
    verb, rest = args[0], args[1:]
    table = {
        "deframe": cmd_deframe,
        "dedup": cmd_dedup,
    }
    if verb in table:
        sys.exit(table[verb](rest) or 0)
    sys.exit(f"알 수 없는 명령: {verb}\n  img help 로 사용법 확인")


if __name__ == "__main__":
    main()
