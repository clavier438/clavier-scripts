# Promotion — reference class (what converts) + autonomy limits

Researched 2026-06. Real conversion data + an honest read on what a system can do on
its own vs what must stay human. Reference-class rule: copy what's working, and name
the limit *before* building.

## What actually converts (ranked by evidence)

- **Reddit, problem-specific subreddits** — one tracked indie hacker: Reddit was 8% of
  traffic but **67% of revenue, ~6.25% conversion**. Highest-revenue channel when you
  post in the sub where the problem actually lives.
- **Indie Hackers** — ~**23% conversion**, but it's a 4-6 month relationship, not a
  launch. Treat it as distribution infrastructure, not a one-time event.
- **Build-in-public on X/Twitter** — sharing revenue / decisions / failures pulls 4-6x
  more followers than feature posts; cases of "4 months building in public → launch-day MRR."
- **Product Hunt** — ~**3% conversion**. A spike, not a base.
- **SEO / programmatic content** — slow (2-4 months to rank) but compounding, and the
  most automatable. Zapier-style search-intent pages.

**Meta-rule (Lenny Rachitsky): ~100% of companies that scaled started with ONE dominant
channel, executed deeply.** Pick one, go 90 days, don't spread across five.

**On every channel:** free value first → funnel to paid; lead with the problem and the
story, not the pitch; cheap price lowers the barrier; authenticity beats reach. The
maker's-bench voice IS a distribution advantage, not just tone.

## Can a system do this on its own? — the honest limit

The channels that convert (Reddit, IH, X) run on **human trust**, and automating the
*posting* destroys the thing that makes them work:
- Reddit **90/10 rule** (≤10% self-promo); automated comments are spotted → **shadowban**;
  automated voting = **ban**. Schedulers tolerated only at human pace, no identical
  cross-posts.
- **So do not build an auto-poster into trust communities** — reference class says it
  backfires. The slice that must stay human (the actual posting) is a feature, not a gap.

What autonomy CAN do sustainably (≈70% of the work):
1. **SEO / content engine** — generate genuinely useful pages + tutorials targeting search
   intent, host on `landing/`. **Limit:** Google issues manual actions for *"scaled content
   abuse"* (mass thin AI pages → full deindex). Quality-gate every page (real value + human
   glance); never spray. AI-assisted-with-value is fine; mass-thin is not.
2. **Draft + schedule, human fires** — auto-write the Reddit/HN/X posts in voice; human
   approves and posts (or a paced scheduler). Removes the writing, keeps the trust.
3. **Monitor** — Gumroad API (sales, views) + mention tracking → the evening report.
4. **Lead magnets** — generate free mini-tools/tutorials that funnel to the paid ones.

**Verdict:** automate the **content, drafts, SEO, analytics**; keep the **community posting
human** (with drafts handed over). Go deep on ONE channel.

## Evening report — proposed routine (confirm before building)

STL: one responsible routine (extend `scriptSeller`, or a sibling marketer routine). Each
evening, autonomously:
- Sales + views per product (Gumroad API).
- Posting status: what shipped, what's drafted and waiting for the human to fire.
- SEO/content progress (pages shipped, early ranking signals).
- **One** concrete next action for the chosen channel — not a scattered list.

Per automation-order: validate the shape first, pick the one channel, *then* wire the cron.

## Sources

- indiehackers.com — "which channels make money vs send traffic" (Reddit 67% of revenue)
- awesome-directories.com — Indie Hackers 23% vs Product Hunt 3% conversion
- prems.ai, branding5.com — indie hacker channel playbooks 2026
- conbersa.ai / redship.io / karmaguy.io — Reddit 90/10, shadowban & automation limits
- searchengineland.com, dev.to/deepakgupta — programmatic SEO for developer tools
- rankability.com, seo.ai — Google "scaled content abuse" manual actions on mass AI content
