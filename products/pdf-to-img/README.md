# pdf-to-img

Turn PDF pages into images — JPG, PNG, TIFF, or WebP — at whatever DPI you need, in one command.

I needed PDF pages as crisp images for decks and previews. The free converters cap resolution or watermark; the paid ones are overkill. So I wrapped ImageMagick into a script that just does it, at the DPI I ask for, across as many files as I throw at it.

## What it does

- Convert one or many PDFs to JPG / PNG / TIFF / WebP
- Set the resolution (DPI) — sharp output for print or screen
- Multi-page PDFs become numbered images automatically

## Install

```bash
brew install imagemagick ghostscript
```

## Usage

```bash
./pdfToImg.sh report.pdf
./pdfToImg.sh -f png -d 300 -o ./images *.pdf
```

Options: `-f jpg|png|tiff|webp` · `-d` DPI (default 150) · `-o` output dir.

## Requirements

ImageMagick + Ghostscript. Mac or Linux. `chmod +x pdfToImg.sh` first.

---

*Honest heads-up: this is the tool I made for myself, cleaned up to share — not a polished SaaS with a support team. The real thing I use, priced low, for you to take and make your own.*
