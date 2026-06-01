# pdf-extract

Drop a folder of PDFs in, get clean text out — every file, Korean and English, page by page.

I had hundreds of PDFs to turn into searchable text. The online converters wanted uploads and subscriptions; the local ones choked on Korean. So I built a batch extractor that runs offline, handles mixed-language docs, and even wakes up iCloud-evicted files before reading them.

## What it does

- Batch-extracts text from every PDF in a folder (recursive optional)
- Page markers (`--- p.N ---`) so you keep the structure
- Korean + English, no OCR needed for text-based PDFs
- iCloud-aware: auto-downloads evicted files before reading
- Skips already-extracted files unless you force a rebuild

## Install

```bash
pip3 install pdfplumber
```

## Usage

```bash
python3 pdf-extract.py ./my-pdfs
python3 pdf-extract.py ./my-pdfs -r -o ./text --open
```

Options: `-r` recurse subfolders · `-o` output dir · `-f` overwrite existing · `-q` quiet · `--open` reveal output in Finder.

## Requirements

Python 3.9+. Mac (iCloud features) or Linux.

---

*Honest heads-up: this is the tool I made for myself, cleaned up to share — not a polished SaaS with a support team. The real thing I use, priced low, for you to take and make your own.*
