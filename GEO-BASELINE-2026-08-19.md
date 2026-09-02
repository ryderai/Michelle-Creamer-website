# Michelle Creamer — GEO baseline, 2026-08-19

**This is the "before" picture. Do not edit it.** Every future score gets compared
against this file. Numbers here were read on **2026-08-19**.

GEO = Generative Engine Optimization: getting a business found, trusted and quoted by
AI search engines (ChatGPT, Google AI Overviews, Perplexity, Gemini, Copilot).

- Site: https://www.michellesellslibertypark.com/ (live host serves the `www.` version)
- Client folder: `AI-Syndicate/Michelle-Creamer/`
- Repo commit at the time of this audit: `1bf6cbc`

---

## 1. The headline number

| What | Score | Read on | Source |
|---|---|---|---|
| AI readability (AI Access audit) | **74 / 100** | 2026-08-19 | AI Syndicate platform, hand-off export |

The platform listed **76 changes** across the site-wide files plus the 25 worst pages.
Structured data and llms.txt were excluded from that 74 — the platform generates those
per-site on their own tabs.

**How to read the 74 honestly.** It covers the site-wide files plus 25 pages. It is not
a sample. It does not include the schema generator's own output or llms.txt.

---

## 2. Site-wide files — before

| File | State on 2026-08-19 | How it was checked |
|---|---|---|
| `robots.txt` | PRESENT, names 14 AI crawlers, `Disallow: /api/` | fetched live |
| `sitemap.xml` | PRESENT, 25 URLs, all `lastmod` 2026-08-13 | fetched live |
| `llms.txt` | **MISSING — 404** | fetched live |
| `llms-full.txt` | **MISSING — 404** | fetched live |
| `agents.md` | **MISSING — 404** | fetched live |
| `security.txt` | MISSING | local folder |

## 3. Page-level coverage — before (all 26 HTML files, counted, not sampled)

| Signal | Pages that have it |
|---|---|
| Canonical tag (`rel="canonical"`) | 26 / 26 |
| Meta description present | 26 / 26 |
| Open Graph tags (`og:title`) | 26 / 26 |
| Geo meta (`geo.region`) | 26 / 26 |
| IDX / MLS disclaimer | 26 / 26 |
| AI Syndicate credit | 26 / 26 |
| Structured data (JSON-LD) | **1 / 26** — homepage only |
| `<main>` landmark | **0 / 26** |
| `meta name="author"` | **0 / 26** |
| Markdown twin (`text/markdown` alternate) | **0 / 26** |

### Titles outside 30–65 characters
- `index.html` — 80 chars
- `join-the-team.html` — 26 chars

### Meta descriptions outside 70–160 characters
- `index.html` — 205
- `accessibility-policy.html` — 54
- `dmca-notice.html` — 45
- `privacy-policy.html` — 48
- `fair-housing-statement.html` — 56

### Pages with fewer than 3 `<h2>` subheadings (AI cannot chunk these well)
0 h2: `accessibility-policy`, `dmca-notice`, `fair-housing-statement`, `privacy-policy`
1 h2: `acreage-lots`, `blog`, `commercial`, `contact-me`, `giving-back`, `luxury`,
`open-houses`, `press`, `property-search`, `property`
2 h2: `about-us`, `communities`, `join-the-team`, `market-trends`, `new-construction`,
`our-story`, `relocation`

---

## 4. Defects found in this audit that the platform list did not name

These were found by reading the source and the live site, not by the scanner.

1. **The live site is two commits behind the repo.** Live shows the old office number
   **(205) 969-8910**; the repo has the corrected **(205) 730-2359** (commit `1bf6cbc`).
   Commit `297d851`, which adds Open Graph link-preview cards to all 26 pages, is also
   not deployed. Measured by fetching the live homepage on 2026-08-19.
2. **The lead-email change is not in effect.** `LEAD_TO_EMAIL` was pointed at Michelle
   on 2026-08-18 but Vercel env changes only take effect on the next deploy. Until the
   push happens, her leads still go to the unwatched growth@ inbox.
3. **Canonical tags point at the non-`www` host** while the live site serves `www.`
   The canonical therefore points at a URL that redirects. Not fixed this week.
4. **The Zillow profile URL on the site uses `http://`**, not `https://`, in all 31
   places including the JSON-LD `sameAs`. Not fixed this week.
5. **Zillow's own page shows 5.0 stars from 51 reviews** (read 2026-08-19). The site
   advertises "5.0 ★ from 70 client reviews". The site does not say where the 70 comes
   from. Not changed — this is Michelle's number to explain, not ours to edit.
6. **The IDX disclaimer wording is still unconfirmed.** An HTML comment in all 26 pages
   reads: "confirm against the signed GALMLS IDX agreement (BAR ticket #113466) before
   this domain goes public." The domain is public. The MLS feed itself is live and
   working (`js/listings.js` `mode: "live"`, real GALMLS OAuth credentials, agent ID
   `creamemi`). It is the wording that is unverified, not the access. This is blocked
   until someone reads the signed agreement.
7. **A buyer-compensation line on two pages** — "her representation costs you nothing
   as the buyer" (`new-construction.html`) and "expert representation on your side often
   costs you nothing out of pocket" (`home-buying-guide.html`). Worth a compliance look
   after the 2024 NAR settlement changes. Deliberately kept out of the AI files.

---

## 5. What Week 1 changed

Three files added at the site root, plus four comment lines appended to `robots.txt`
pointing at them. **Nothing else was touched.** No schema, no `<main>` wrappers, no meta
rewrites, no markdown twins — those are Weeks 2 and beyond.

| File | Lines | What it is |
|---|---|---|
| `llms.txt` | 104 | Short AI-readable summary: who she is, contact, services, areas, key pages |
| `llms-full.txt` | 309 | Long reference: services in detail, Liberty Park, ARC Realty, 11 FAQs, an attribution guide, licensing and crawl rules |
| `agents.md` | 94 | Orientation page for AI agents: quick facts, important pages, how to attribute, crawl rules |

## 6. How to re-measure later

1. Fetch `https://www.michellesellslibertypark.com/llms.txt`, `/llms-full.txt` and
   `/agents.md`. All three must return 200. On 2026-08-19 all three returned 404.
2. Re-run the AI Access audit in AI Syndicate for `michellesellslibertypark.com`.
3. Compare the new score to **74**. Write the new number and its date in a new file —
   do not edit this one.
4. Re-run the coverage counts in section 3 from the client folder:

```bash
cd AI-Syndicate/Michelle-Creamer
for f in llms.txt llms-full.txt agents.md robots.txt sitemap.xml; do
  printf "%-16s %s\n" "$f" "$([ -f "$f" ] && echo PRESENT || echo MISSING)"; done
T=$(ls *.html | wc -l)
for p in 'application/ld+json' 'geo.region' 'rel="canonical"' 'text/markdown' \
         'name="author"' '<main' 'name="description"' 'og:title'; do
  printf "%-24s %s/%s\n" "$p" "$(grep -li "$p" *.html | wc -l)" "$T"; done
```

## 7. Suggested running order for the remaining weeks

One visible step per week. This is a proposal, not built work.

- **Week 2** — Structured data (JSON-LD) on all 26 pages. Biggest single gap: 1 of 26.
- **Week 3** — `<main>` landmark and 3+ `<h2>` sections on the thin pages, so AI can
  chunk them. Covers 0/26 and 21 pages respectively.
- **Week 4** — FAQ schema on `home-buying-guide.html`, which already reads as an FAQ.
- **Week 5** — Rewrite the 5 out-of-range meta descriptions and 2 out-of-range titles.
- **Week 6** — `meta name="author"` and Person schema across the site (0/26 today).
- **Week 7** — Markdown twins of every page (0/26 today).
- **Week 8** — Fix the canonical host mismatch and the `http://` Zillow URL, then re-scan.

---

Audited and built by AI Syndicate, 2026-08-19. Checked by a second agent before filing.
