# img-to-web

Batch-convert images to WebP (or optimized JPG/PNG) — resize and compress a whole folder in one command.

Every site I ship needs images squeezed down without looking like garbage. The drag-and-drop web tools are slow and one-at-a-time; the GUI apps are bloated. So I wrote a one-liner that takes a glob, resizes, compresses, and spits out web-ready files.

## What it does

- Convert many files at once (globs supported) to WebP / JPG / PNG
- Set quality and a max width — keeps aspect ratio
- Writes next to the originals or to an output folder you pick

## Install

```bash
brew install webp   # for WebP output (JPG/PNG use built-in macOS sips)
```

## Usage

```bash
./imgToWeb.sh *.png
./imgToWeb.sh -f webp -q 82 -w 1600 -d ./out photos/*.jpg
```

Options: `-f webp|jpg|png` · `-q 1-100` quality (default 82) · `-w` max width (default 1920, 0 = keep) · `-d` output dir.

## Requirements

macOS (uses `sips` + `cwebp`). `chmod +x imgToWeb.sh` first.

---

*Honest heads-up: this is the tool I made for myself, cleaned up to share — not a polished SaaS with a support team. The real thing I use, priced low, for you to take and make your own.*
