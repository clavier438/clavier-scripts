#!/usr/bin/env python3
# img — 로컬 이미지 폴더 처리 단일 front door (workerCtl / brandRe / framer 패턴).
#
# 정신: 그룹 없이 ~/bin 에 우수수 떠돌던 image-*/photo-* 도구들을 동사 하나로 모은다.
#   내부 모듈(image-filter-graphic-frame.py 등)은 그대로 두고, 사용자는 `img` 에서
#   verb 만 고른다 — 얇은 라우터, 모듈성 유지 (CLAUDE.md framer 절 / reuse-first 스킬).
#
#   img deframe <folder> [옵션]   그래픽 프레이밍(가장자리 단색 패딩 띠) 감지 → 격리/삭제
#   img help
#
# 향후 흡수 예정(현재 독립 ~/bin 도구): dedup · tag · convert · cluster · lut · pattern · ref-fetch.
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


HELP = """img — 로컬 이미지 폴더 처리 (단일 front door)

  img deframe <folder> [옵션]
      가장자리 단색 패딩 띠(레터박스·흰 여백·텍스트 카드 배경)로 프레이밍된
      이미지를 감지. 기본 dry-run (실제 변경 없음).
        --delete         감지된 것 삭제
        --move-to DIR    격리 폴더로 이동 (검수용)
        --tol N          단색 판정 변동 허용 (기본 2)
        --min-band N     그래픽으로 볼 최소 띠 두께 px (기본 31)
        --report PATH    결과 JSON 저장

  img help

(향후 흡수 예정 — 현재 독립 도구: dedup · tag · convert · cluster · lut · pattern · ref-fetch)
"""


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("help", "-h", "--help"):
        print(HELP.strip())
        return
    verb, rest = args[0], args[1:]
    table = {
        "deframe": cmd_deframe,
    }
    if verb in table:
        sys.exit(table[verb](rest) or 0)
    sys.exit(f"알 수 없는 명령: {verb}\n  img help 로 사용법 확인")


if __name__ == "__main__":
    main()
