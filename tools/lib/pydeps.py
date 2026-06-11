# pydeps — 실행에 필요한 pip 패키지가 없으면 *자동 설치* (수동 안내 금지가 원칙).
#
#   왜 lib 인가: 사용자에게 "pip install X 하세요" 떠넘기는 건 B1 병목(거짓 떠넘김 —
#     CONVENTIONS "의존성 자동 설치 원칙"). lut.mjs 의 ensureDeps(brew 자동설치)와 같은
#     정신을 Python 쪽에 단일 소스로. 도구가 스스로 필요한 걸 갖춘다.
#
#   사용:
#     from pydeps import ensure
#     np = ensure("numpy")                 # pip 이름 = import 이름
#     Image = ensure("pillow", "PIL.Image")  # pip 이름 ≠ import 이름(서브모듈)
#
#   설치 대상 = 현재 인터프리터(sys.executable) — VENV_PY 로 실행되면 그 venv 에 들어간다.

import importlib
import subprocess
import sys


def ensure(pkg, import_name=None):
    """import 시도 → 없으면 현재 인터프리터에 자동 설치 후 재시도. 임포트된 모듈 반환.

    pkg = pip 패키지명. import_name = import 경로(pip 명과 다를 때, 예 pillow→PIL.Image).
    설치 실패 시 예외 그대로 — 자동 설치가 *원칙*이지 침묵이 아니다(실패는 보고)."""
    name = import_name or pkg
    try:
        return importlib.import_module(name)
    except ImportError:
        print(f"· {pkg} 자동 설치 (실행에 필요한데 없음)...", file=sys.stderr)
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", pkg])
        return importlib.import_module(name)
