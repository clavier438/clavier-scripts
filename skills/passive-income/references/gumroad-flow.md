# Gumroad publishing — the exact flow + the walls you'll hit

Read this when actually creating/publishing a Gumroad product. Every caveat
below was learned the hard way; honoring them saves a lot of thrashing.

## What only the human can do (route these to the PR checklist, never bury in chat)

- **Account creation / login.** You cannot create the account or enter a
  password. If gumroad.com/dashboard isn't logged in, stop and ask the human.
- **The file upload.** The Claude-in-Chrome `file_upload` tool only accepts files
  *attached to the chat* — not arbitrary local paths (Downloads, the repo, the
  session dir, and `@path` mentions all get rejected). The native "Upload files"
  button opens an OS picker you can't touch either. **So the human must drag each
  zip** from `~/Desktop/gumroad-zips/` onto Gumroad's "Upload your files" area.
  Stage every zip there and open the folder (`open ~/Desktop/gumroad-zips/`) so
  the drag is one motion.
- **Payout + identity.** Connecting a bank account / PayPal and the "Where are you
  located?" identity attestations are financial/legal — the human enters those.
  (Korea: bank payout avoids PayPal's 2% fee; Business account needs the
  사업자등록번호 as Tax ID and "Sole Proprietorship" for 개인사업자.)

## What you CAN do (drive these in the browser)

1. **New product**: gumroad.com/products → New product → Digital product. Fill
   **Name** (`Tool — what it does`, em-dash tagline) and **Price** (cheap band,
   see below) → Next: Customize.
2. **Description**: click into the editor, type the BRAND_VOICE copy (plain text
   with `•` bullets is reliable; the editor does NOT auto-render markdown). Then
   **bold the headers**: triple-click each header line → click the Bold button.
   Headers to bold: the hook line, `What it does:`, `Why it's cheap:`, `Run it:`,
   `Requirements:`. The right-hand Preview pane shows the rendered result.
3. **Save** (Save and continue) → **Content tab** → wait for the human's zip drag
   → once the file row shows, **Publish and continue**.
4. The product is then **live** at `https://<seller>.gumroad.com/l/<slug>`.

## Editor gotchas

- To replace existing copy: click *inside* the editor first, then `cmd+a` →
  `Backspace`. (If focus isn't in the editor, Backspace triggers browser-back —
  don't `cmd+a`/`Backspace` unless the caret is in the field.)
- Add tags one at a time with a beat between each (type → Return → wait ~1s),
  or fast entries merge into one garbled tag.
- The Chrome extension can briefly lose page access after odd key combos; if
  screenshots start failing with a permission error, have the human refresh the
  Gumroad tab.

## Gumroad Discover (category + tags) — gated, don't fight it

Selecting a Discover **Category** + **Tags** is how a product shows in Gumroad's
marketplace. But Gumroad **silently reverts category to "Other" and clears tags
on save until the product is Discover-eligible** — which requires **(1) at least
one sale + (2) passing Risk Review**. So: set category/tags only *after* the
first sale. Before that, attempting it just resets — note it in the PR as a
"post-first-sale" item and move on. (Discover sales also take a flat 30% fee.)

## Pricing band (cheap on purpose)

Nothing over $15. The pitch is "grab it, it's cheaper than an hour of your time."
Typical: Quick-Action/tiny utility $5 · shell tool $7 · script w/ deps $9 ·
flagship script $12–14. Confirm the exact number in the PR; the human can adjust.
