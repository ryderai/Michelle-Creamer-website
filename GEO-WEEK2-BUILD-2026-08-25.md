# Michelle Creamer — Week 2 build record
**Built 2026-08-25. NOT PUSHED.** New file; does not replace `GEO-RESCAN-2026-08-25.md`
(the scan) or `GEO-BASELINE-2026-08-19.md` (the baseline).

Before-state for every number here: `GEO-RESCAN-2026-08-25.md`.
An unmodified copy of all 26 original .html files is at `/tmp/mc-backup/` in the desktop
workspace — it will not survive a restart, but git HEAD `df8aebb` is the real rollback.

## What changed, file by file

### Every one of the 26 pages
- `<meta name="author" content="Michelle Creamer">`
- `<meta name="tdm-reservation" content="0">` — the W3C signal that says AI may read and
  quote this site. Platform valued this at +33 points on the AI-intent front.
- `<link rel="alternate">` × 3 pointing at `/llms.txt`, `/llms-full.txt`, `/agents.md`.
  Platform valued this at +14.
- A `<link rel="alternate" type="text/markdown">` pointing at that page's own markdown
  mirror — every page except `property.html`, which has no static content.
- Content wrapped in `<main id="main">` … `</main>`, between the end of the nav and the
  footer. **This was built wrong the first time** — `<main>` opened inside the nav on all
  26 pages because the anchor matched an indented `</div>` in a dropdown. Caught by
  re-reading the file, fixed, and re-verified: `<main>` now opens after `</nav>`'s closing
  `</div>`, closes before `<footer>`, no nav markup inside it, `<div>` counts identical to
  the backup on all 26.
- JSON-LD on every page. It was on 1 of 26.

### Homepage identity — the fix for "AI thinks this site is ARC Realty"
The `Organization` node `#arc` was three words and nothing else. It now carries ARC's url
and office address. The primary entity is now `RealEstateAgent` + `LocalBusiness` named
**"Michelle Creamer"** (was "Michelle Creamer, Realtor — ARC Realty", which is likely what
the extractor latched the brokerage name onto). Added: a `WebPage` node with
`SpeakableSpecification` (platform: +11), and an `FAQPage` with the 8 Q&A pairs already
vetted in `llms.txt` — the platform calls FAQPage "the single biggest AI-Overview lever"
and it was the one missing homepage essential.

`sameAs` went 3 → 5 on both the business and the person:
facebook.com/michelle.creamer.96 · linkedin.com/in/michelle-creamer-71bbba43 ·
zillow.com/profile/mcreamer1 (**upgraded from `http://` to `https://`**) ·
google.com/maps?cid=10013070984403547862 · app.arcrealtyco.com/michellecreamer-1444.

The Maps CID decodes exactly from the `placeid=ChIJ2dAPO4kXiYgR1vYkQAKT9Yo` already
published on the site. The ARC agent-profile URL was already linked from index,
contact-me and property-search. Neither is a new claim.

Dropped: the `employee` property that pointed the business at a `Person` of the same name —
one human modelled as her own employee. A checker flagged it; both nodes still resolve to
the same identity through matching `sameAs` and their shared link to `#arc`.

### The 25 subpages
Each got a `WebPage` / `Blog` / `CollectionPage` node plus a `BreadcrumbList` matching the
breadcrumb that was already on the page. 11 service pages also got a `Service` node.
Extra hand-written blocks: `FAQPage` on home-buying-guide, liberty-park and my-home-value;
`HowTo` on home-buying-guide, built from the purchase stages the page itself lists.

### Headings
`privacy-policy` — 4 `<h3>` promoted to `<h2>` (the page jumped h1 → h3).
`dmca-notice` +2 `<h2>`, `accessibility-policy` +3, `fair-housing-statement` +3 — all four
had zero. `property.html` had no `<h1>` at all: added a static one, and added one to the
"no listing" branch of `js/property.js` so it survives when the MLS returns nothing.

### Markdown mirrors — 25 files
A plain-text copy of every page, linked from that page's `<head>`. This closes
`no-md-alternate`, which the platform flagged on all 25 audited pages.

**Two compliance rules are enforced in the mirrors, and they are deliberate:**
1. **No unsourced school-ranking superlatives.** The HTML pages say Liberty Park Middle is
   "the #1 middle school in Alabama" and the elementary is "a top-10 elementary school in
   Alabama", naming no ranking body and no year. The mirrors state the neutral zoning fact
   and say to ask Vestavia Hills City Schools for ratings — the same rule
   `llms.txt` already follows. Unsourced school-quality superlatives in a
   machine-readable file published by a licensed agent are fair-housing exposure.
2. **No buyer-compensation cost claims.** "often costs you nothing out of pocket"
   (home-buying-guide) and "costs you nothing as the buyer" (new-construction) are left out
   — post-NAR-settlement risk.
   Each mirror's front matter states both omissions in plain words, so the mirror is not
   pretending to be a complete copy.
3. Every mirror ends with the **Greater Alabama MLS / IDX disclaimer**, which lives in the
   site footer and would otherwise have been missing from all 25 files.

The first build of these mirrors did carry both #1 and #2. A hostile checker caught it and
they were rebuilt.

### Metadata
`index` title 80 → 58 characters, description 205 → 147. `about-us` description was ARC
brochure copy that never mentioned Michelle, Liberty Park or Vestavia Hills — rewritten.
`our-story`, `join-the-team`, `relocation` and the 4 legal pages' 45–56-character
boilerplate descriptions rewritten. Every rewrite uses only facts already published on the
site. og: and twitter: tags kept in sync.

### PUBLIC EXPOSURE FOUND AND CLOSED — read this one
`https://www.michellesellslibertypark.com/GEO-BASELINE-2026-08-19.md` **was publicly
readable.** Fetched and confirmed on 2026-08-25. That is our internal audit of her site,
including the note that her "#1 agent" line is her own claim, the review-count
discrepancy, and the note that the GALMLS IDX disclaimer was never checked against the
signed agreement. Four more internal documents sat beside it: `GO-LIVE-MONDAY.md` (which
names the MLS username `AISCidx` and the vendor support address), `HANDOFF-FOR-CJ-ANDREW.md`,
`listings-js-patch.md`, and today's `GEO-RESCAN-2026-08-25.md`. **No live password was in
any of them** — GO-LIVE-MONDAY uses the placeholder `YOUR_PASSWORD`.

Two mechanisms are now in place, deliberately belt-and-braces:
- `.vercelignore` naming the six files. A checker correctly pointed out this governs CLI
  uploads and may do nothing on a GitHub → Vercel deploy.
- `vercel.json` `rewrites` sending each of those paths to `/_internal-not-public`, which
  does not exist, so Vercel returns 404. This works on a Git deploy.

**This is NOT proven closed.** It is proven closed only when someone fetches that URL after
the deploy and gets a 404. Do not report it as fixed before then. The permanent fix is to
move those five files out of the deploy root — that needs Cursor, because the desktop
mount cannot delete or move files.

### Other
`vercel.json` also now sends a `Link: rel="canonical"` header on every `.md`, pointing at
that page's HTML, so the mirrors are not duplicate content competing with the real pages.
`sitemap.xml` lastmod 2026-08-13 → 2026-08-25 on all 25 entries (every page really did
change today). `robots.txt` gained a comment describing the mirrors.

## How this was verified — what was actually done, not "should work"

- All 26 pages re-parsed on disk: exactly one JSON-LD block each, all parse, every `@id`
  reference resolves, exactly one `<h1>`, at least one `<h2>`, `<main>` in the right place,
  `<div>` balanced, no `<script>` inside `<main>`, every `rel=alternate` target exists.
- **All 26 pages rendered in a real headless Chromium** and screenshotted at 1280px. Zero
  page errors, zero console errors, zero horizontal overflow. The four legal pages' new
  headings render in the site's own type. `property.html` shows its new `<h1>` above the
  "Awaiting MLS connection" panel.
- A separate hostile checker agent reviewed the whole build against a backup diff and
  returned 3 blockers and 13 lesser findings. All 3 blockers and 9 of the 13 are fixed. The
  4 left open are recorded below.

## Known and left open, on purpose

- **`liberty-park.html` title is 64 characters.** Descriptive and pre-existing; not worth
  cutting.
- **"seamless" still appears 5 times in `relocation.html` body copy.** It is a banned word
  in our own writing; this is the client's page copy, so it is CJ's call, not ours. The
  meta description no longer uses it.
- **`my-home-value` still carries "In 2019, ARC agents sold homes $40,000 more and 8 days
  faster than the market average"** — a seven-year-old unsourced brokerage stat, now
  visible to AI readers through the mirror. Flagged, not removed: it is the client's own
  published marketing.
- **Stat tiles read as run-on lines in a few mirrors** (e.g. "$60M — Sold in 2024 alone
  $49.5M — Sold in Vestavia Hills"). Separators were added and it is legible; it is not
  pretty.
- **Four pages still lead with ARC rather than Michelle in their body copy** — about-us,
  our-story, giving-back, join-the-team. Only their metadata was changed. Rewriting visible
  copy on a client's live pages is CJ's and Michelle's call, not a contractor's.

## Before this can be called done

1. `rm -f .git/index.lock` in Cursor — a `git status` from the desktop mount left one
   behind, which is a known trap for this folder.
2. Review the diff, commit, push, deploy.
3. Fetch `https://www.michellesellslibertypark.com/GEO-BASELINE-2026-08-19.md` and confirm
   a **404**. Until then the exposure is open.
4. Fetch a few `.md` mirrors and confirm `text/markdown` and the canonical `Link` header.
5. Re-run AI Access on the platform. Before: 82/100, structured data 38, AI intent 42,
   identity 55, page content quality 76.
6. `curl -I https://michellesellslibertypark.com/` and settle the www-vs-apex question that
   `GEO-RESCAN-2026-08-25.md` left open.
