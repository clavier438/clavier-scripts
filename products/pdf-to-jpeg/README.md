# PDF to JPEG — Mac Quick Action

Right-click any PDF in Finder → get JPEGs. No app to open, no dependencies, nothing to install but this.

I just wanted to right-click a PDF and get images, the way macOS should already do. So I built a Quick Action that uses the converter already baked into macOS (Quartz) — zero extra software, works offline, every page comes out as a JPEG.

## What it does

- Adds a **PDF to JPEG** option to Finder's right-click menu
- Converts every page of the PDF to a JPEG, into a folder next to it
- Uses built-in macOS rendering — no Homebrew, no Python packages, nothing

## Install

1. Double-click `PDF to JPEG.workflow` (or copy it to `~/Library/Services/`).
2. Approve the install when macOS asks.

## Use

Right-click any PDF → **Quick Actions** → **PDF to JPEG**. Done.

## Requirements

macOS. That's the whole list.

---

*Honest heads-up: this is the tool I made for myself, cleaned up to share — not a polished product with a support team. The real thing I use, priced low, for you to take and make your own.*
