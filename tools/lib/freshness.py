"""freshness.py — 모든 .py tool 의 첫 import.

SSOT 의 두 번째 강제 장치 (pre-commit + post-commit 에 이어):
  "stale 로컬 코드로 실행" 이라는 상태 자체가 존재할 수 없게 한다.

호출 방식 (caller 첫 실행 라인, docstring/import 직후):
  import sys, os
  sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
  import freshness  # noqa: F401  (import 부수효과로 검사 수행)

동작 — freshness.mjs 동일. 자세한 사양은 그쪽 헤더 참조.
"""

import os
import subprocess
import sys
from pathlib import Path


def _ensure_fresh() -> None:
    if os.environ.get("_CLAVIER_FRESHNESS_OK") == "1":
        return
    if os.environ.get("CLAVIER_LOCAL_DEV") == "1":
        os.environ["_CLAVIER_FRESHNESS_OK"] = "1"
        return
    if os.environ.get("GIT_DIR") or os.environ.get("_CLAVIER_IN_HOOK") == "1":
        return

    repo = Path(__file__).resolve().parent.parent.parent  # tools/lib/.. /..

    try:
        branch = subprocess.check_output(
            ["git", "-C", str(repo), "symbolic-ref", "--short", "HEAD"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return

    if branch != "main":
        os.environ["_CLAVIER_FRESHNESS_OK"] = "1"
        return

    try:
        subprocess.run(
            ["git", "-C", str(repo), "fetch", "--quiet", "origin", "main"],
            check=True, timeout=8, stderr=subprocess.PIPE,
        )
    except Exception:
        print("\033[33m! freshness: git fetch 실패 (오프라인?) — 로컬 main 으로 진행\033[0m", file=sys.stderr)
        os.environ["_CLAVIER_FRESHNESS_OK"] = "1"
        return

    try:
        counts = subprocess.check_output(
            ["git", "-C", str(repo), "rev-list", "--left-right", "--count", "main...origin/main"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
        ahead, behind = map(int, counts.split())
    except Exception:
        os.environ["_CLAVIER_FRESHNESS_OK"] = "1"
        return

    if ahead == 0 and behind == 0:
        os.environ["_CLAVIER_FRESHNESS_OK"] = "1"
        return

    if ahead > 0:
        print(
            f"\n\033[31m‼️  freshness: 로컬 main 이 origin 보다 {ahead} commit 앞섭니다.\033[0m\n"
            f"\033[31m    main 직접 커밋은 pre-commit hook 으로 차단되니 이 상태는 정상이 아닙니다.\033[0m\n"
            f'\033[31m    조사:  git -C "{repo}" log origin/main..main\033[0m\n',
            file=sys.stderr,
        )
        sys.exit(2)

    try:
        subprocess.run(
            ["git", "-C", str(repo), "pull", "--ff-only", "--quiet", "origin", "main"],
            check=True, timeout=8, stderr=subprocess.PIPE,
        )
        print(f"\033[36mℹ freshness: origin/main 에서 {behind} 새 commit 적용\033[0m", file=sys.stderr)
        os.environ["_CLAVIER_FRESHNESS_OK"] = "1"
    except Exception:
        print(
            "\n\033[31m‼️  freshness: ff-only pull 실패 — 로컬 main 에 uncommitted/untracked 변경?\033[0m\n"
            f'\033[31m    조사:  git -C "{repo}" status\033[0m\n',
            file=sys.stderr,
        )
        sys.exit(2)


_ensure_fresh()
