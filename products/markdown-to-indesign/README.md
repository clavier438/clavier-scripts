# markdown-to-indesign

Write in Markdown, format in InDesign — one Find/Change script turns `#`, `**bold**`, lists and quotes into real InDesign styles.

Pasting text into InDesign and hand-styling every heading is the slowest part of layout. I write everything in Markdown anyway, so I built a Find/Change list that reads the Markdown marks and applies paragraph/character styles in one pass.

## What it does

- Converts Markdown marks (`#` headings, `**bold**`, `*italic*`, lists, `>` quotes) into InDesign styles
- Runs as a single Find/Change-by-List pass — fast and repeatable
- Ships with a starter style set (`MarkdownStyles.idms`) you can restyle to your brand

## Install

1. Load the styles: **File → Load Styles** → `MarkdownStyles.idms` (or build your own with the same names).
2. Put `FindChangeByListMarkdown.jsx` (and the `FindChangeSupport` folder) in your Scripts panel folder.

## Use

Select your Markdown text frame → run **FindChangeByListMarkdown** from the Scripts panel.

## Requirements

Adobe InDesign (ExtendScript). Mac or Windows.

---

*Honest heads-up: this is the tool I made for myself, cleaned up to share — not a polished product with a support team. The real thing I use, priced low, for you to take and make your own.*
