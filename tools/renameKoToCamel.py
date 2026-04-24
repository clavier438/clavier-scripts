#!/usr/bin/env python3
"""
Korean filename → camelCase English filename renamer
Usage:
  python3 rename_ko_to_camel.py          # preview only
  python3 rename_ko_to_camel.py --run    # actually rename files
"""

import re
import sys
from pathlib import Path

try:
    from deep_translator import GoogleTranslator
except ImportError:
    print("deep-translator not installed. Run: pip3 install deep-translator")
    sys.exit(1)

TARGET_DIR = Path(".")
DRY_RUN = "--run" not in sys.argv

tr = GoogleTranslator(source="ko", target="en")


def to_camel(s: str) -> str:
    words = re.findall(r"[a-zA-Z0-9]+", s)
    if not words:
        return "untitled"
    return words[0].lower() + "".join(w.capitalize() for w in words[1:])


def is_korean(s: str) -> bool:
    return any(ord(c) >= 128 for c in s)


def main():
    files = sorted(TARGET_DIR.rglob("*.md"))
    candidates = [f for f in files if is_korean(f.stem)]

    if not candidates:
        print("No Korean filenames found.")
        return

    mode = "PREVIEW" if DRY_RUN else "RENAMING"
    print(f"[{mode}] {len(candidates)} file(s)\n")

    for f in candidates:
        translated = tr.translate(f.stem)
        new_stem = to_camel(translated)
        new_name = f.with_name(new_stem + f.suffix)

        print(f"  {f.relative_to(TARGET_DIR)}  →  {new_name.name}")

        if not DRY_RUN:
            if new_name.exists():
                print(f"    [SKIP] target already exists: {new_name.name}")
                continue
            f.rename(new_name)

    if DRY_RUN:
        print("\nDry run. Pass --run to apply changes.")


if __name__ == "__main__":
    main()
