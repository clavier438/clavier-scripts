# rename-ko-to-camel

Rename Korean filenames to clean camelCase English — translated, in bulk, with a safe preview first.

Korean filenames break things — URLs, builds, git on some systems. Renaming them by hand is misery. So I built a renamer that translates each name to English and camelCases it, and always shows you a dry-run before it touches anything.

## What it does

- Translates Korean filenames → English, formatted as camelCase
- **Preview by default** — see every rename before it happens
- `--run` to actually apply

## Install

```bash
pip3 install deep-translator
```

## Usage

```bash
cd folder-with-korean-files
python3 renameKoToCamel.py          # preview only
python3 renameKoToCamel.py --run    # apply
```

## Requirements

Python 3.9+. Internet (uses Google Translate). Mac or Linux.

---

*Honest heads-up: this is the tool I made for myself, cleaned up to share — not a polished SaaS with a support team. The real thing I use, priced low, for you to take and make your own.*
