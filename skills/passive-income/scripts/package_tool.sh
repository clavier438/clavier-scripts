#!/usr/bin/env bash
# package_tool.sh — non-destructively stage + zip a tool for sale.
#
# Internal tools couple to the repo's `freshness` usage tracker (a `import
# freshness` line in .py, a `. .../lib/freshness.sh` line in .sh). That import
# would crash on a buyer's machine, so we strip it from a *copy* — the original
# stays untouched and keeps its tracking.
#
# Usage:
#   package_tool.sh <dest_dir> <source> [<source> ...]
#
#   dest_dir   where the clean, sellable copy goes (e.g. products/site-scraper)
#   source     a script file (.py/.sh) or a bundle dir (.workflow, a folder)
#
# After staging, write README.md into <dest_dir> in the maker's-bench voice
# (see products/BRAND_VOICE.md), then re-run with the same args to rebuild the
# zip — or it zips automatically once a README.md is present.
#
# Example:
#   package_tool.sh products/site-scraper tools/site-scraper.py
#   # ...write products/site-scraper/README.md...
#   package_tool.sh products/site-scraper tools/site-scraper.py   # zips now
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: package_tool.sh <dest_dir> <source...>" >&2; exit 1; }
DEST="$1"; shift
mkdir -p "$DEST"

strip_freshness() {  # stdin -> stdout, removes the internal coupling lines
  grep -vE 'import freshness|sys\.path\.insert.*"lib"|freshness\.sh'
}

for src in "$@"; do
  base="$(basename "$src")"
  if [ -d "$src" ]; then
    cp -R "$src" "$DEST/$base"                      # bundle (.workflow, folder)
  elif [[ "$base" == *.py || "$base" == *.sh ]]; then
    strip_freshness < "$src" > "$DEST/$base"        # strip coupling on copy
    [[ "$base" == *.sh ]] && chmod +x "$DEST/$base"
  else
    cp "$src" "$DEST/$base"                          # other asset, copy as-is
  fi
done

# Syntax-check what we can — a broken sellable copy is worse than none.
for f in "$DEST"/*.py;  do [ -e "$f" ] && python3 -m py_compile "$f" && echo "  py-ok  $f"; done 2>/dev/null || true
for f in "$DEST"/*.sh;  do [ -e "$f" ] && bash -n "$f"            && echo "  sh-ok  $f"; done 2>/dev/null || true

# A sale needs a README. Zip only once it exists, so buyers always get docs.
slug="$(basename "$DEST")"
if [ -f "$DEST/README.md" ]; then
  ( cd "$DEST" && rm -f "$slug.zip" \
    && zip -r -q "$slug.tmp.zip" . -x '*.zip' '*__pycache__*' '.DS_Store' \
    && mv "$slug.tmp.zip" "$slug.zip" )
  echo "  zipped $DEST/$slug.zip"
  unzip -l "$DEST/$slug.zip" | awk 'NR>3 && $4!="" {print "    - "$4}'
else
  echo "  staged (no README.md yet) — write $DEST/README.md in BRAND_VOICE, then re-run to zip."
fi
