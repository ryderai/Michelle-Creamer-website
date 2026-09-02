# Michelle Creamer — GEO re-scan and upgrade options
**Measured Tuesday 2026-08-25.** New file. Does not replace `GEO-BASELINE-2026-08-19.md`.

Every number below is labelled one of two ways:
- **PLATFORM** = the AI Syndicate dashboard reported it.
- **MEASURED HERE** = this session fetched the live site and counted it.

---

## 1. Where the score sits

**PLATFORM, AI Access, michellesellslibertypark.com, scan run 2026-08-25:**

| Front | Score | Change shown |
|---|---|---|
| **AI Access (overall)** | **82 / 100** | ▼ −1 since the previous audit |
| Structured data | 38 | −29 |
| AI intent & permission | 42 | — |
| Identity (NAP) | 55 | — |
| Page content quality | 76 | — |
| AI crawler access | 100 | — |
| Sitemap | 100 | — |
| llms.txt & agents | 100 | +31 |
| robots.txt | 100 | — |
| Crawlability | 100 | — |

The panel reads "5 audits · Aug 19 → Aug 25". The platform prints the −1 against
"last audit" without naming which of those five that was, so treat −1 as the platform's
own wording, not as a verified Aug-19-to-Aug-25 comparison.

The two moving parts cancel out: llms.txt & agents went up 31 (the Week 1 files landing),
structured data went down 29. Net −1. **The Aug 19 record quotes 74 baseline and 80 after
the Week 1 push. 82 today is the highest recorded number for this domain.**

**PLATFORM's own top-fix callout:** "Structured data — 38/100 · Your biggest lever —
about 11% of your AI Access score." That 11% is the platform's phrasing, not our
calculation.

## 2. What is actually missing — MEASURED HERE

All 26 live pages were fetched from inside the browser on the site's own origin and each
one parsed. Not a sample.

| Thing | Count |
|---|---|
| Pages with a JSON-LD block | **1 of 26** (homepage only) |
| Pages with a `<main>` element | **0 of 26** |
| Pages with `<meta name="author">` | **0 of 26** |
| Pages with fewer than three `<h2>` | 21 of 26 |
| Pages with zero `<h2>` | 4 (accessibility-policy, dmca-notice, fair-housing-statement, privacy-policy) |
| Images with no alt text | **0** — clean |
| Canonical tag host | 26 of 26 point at the **apex** (no `www.`) |
| `property.html` `<h1>` count | 0 |

**PLATFORM's page audit, same day**, 25 pages sampled from the sitemap, average page AI
score 76/100, four most common issues: `no-md-alternate` 25, `no-semantic-html` 25,
`no-main` 25, `no-author` 24.

This is **not** an independent confirmation of the numbers above — both readings parse the
same 26 static files off the same template, so they share a common cause by construction.
It is the platform agreeing about the same artifact. Note the one disagreement worth
recording: the platform flags `no-author` on 24 of its 25 sampled pages; our own count is
0 of 26 pages carrying an author tag. One page differs and we did not chase which.

## 3. Live is in sync with the repo — PROVEN BY HASH, not by file size

SHA-256 of the live file compared with the repo copy, first 16 hex characters, 7 files:

| File | Live and repo |
|---|---|
| /llms.txt | 8beeb240e7441e1f |
| /llms-full.txt | fc7ae844c0765f31 |
| /agents.md | 1a080d1aad409e45 |
| /robots.txt | f89dea51d844915b |
| /sitemap.xml | dbc9503031e866fb |
| /index.html | 330137786c08171f |
| /liberty-park.html | 3aa42eebf893b201 |

All seven identical. Repo HEAD is `df8aebb`, working tree clean, nothing unpushed.
**The "live is behind the repo" trap from Aug 19 is closed.** The rebuilt llms files the
Notion task called "sitting in the folder unpushed" are live — llms.txt & agents scoring
100 is that push landing.

## 4. The identity problem — the most valuable finding of the day

**PLATFORM, Identity (NAP) audit, 2026-08-25:**
- Canonical business name extracted from the site: **"ARC Realty"**
- ADDRESS: "Not published" · EMAIL: "Not published" · PHONE: `+12059998164`
- Missing fields flagged: street address, city, state/region, postal code, linked profiles (sameAs)
- External citation probe: **POSSIBLE MATCH** on Google Business Profile, LinkedIn,
  Facebook, Instagram, Yelp, BBB, OpenStreetMap. **NOT FOUND** on Clutch, Foursquare,
  Bing Places. Apple Maps "check manually".

"POSSIBLE MATCH" is the platform's hedge — it means the name matched but nothing on the
listing links back to her site. Of the seven, three were verifiable from the URL as ARC
Realty the brokerage rather than Michelle: `facebook.com/arcrealtyal`,
`instagram.com/arc_realty`, `yelp.com/biz/arc-realty-tustin-5`. That last one is a
**California** ARC Realty, which means at least one of these matches is not even the right
brokerage. The other four were not individually verified here.

**MEASURED HERE — what the homepage schema actually says.** One JSON-LD block, 9 types.
Three separate nodes carry an identity:

| Node | Name | Address | Phone | sameAs |
|---|---|---|---|---|
| `RealEstateAgent` (`#business`) | Michelle Creamer, Realtor — ARC Realty | 3215 Endeavor Lane Suite 113, Vestavia Hills AL 35242 | +1-205-730-2359 | 3 links |
| `Person` (`#michelle`) | Michelle Creamer | — | +1-205-999-8164 | 3 links |
| `Organization` (`#arc`) | **ARC Realty** | **none** | **none** | **none** |

The `Organization` node is name-only — three words and nothing else. The site therefore
hands AI engines three competing identities with two different phone numbers, and the
`Organization` node is the emptiest of the three while being the one that carries the
brokerage's name.

**Stated as a hypothesis, not a proven cause:** that bare `Organization` node is the
likeliest reason the platform reads the site as "ARC Realty". This was NOT tested — we
did not amend the node and re-scan. Counter-evidence worth keeping: the phone the platform
extracted (`+12059998164`) belongs to the `Person` node, not the `Organization` node, so
the extractor is clearly reading across nodes and the picture is not that simple.

Also real and not a hypothesis: `sameAs` has only 3 links (the platform's target is 5),
and the Zillow link is `http://` not `https://`.

## 5. Three cheap page-level signals — PLATFORM, AI intent & permission 42/100

"Only 3 of 6 signals are in place." The three missing, with the platform's own point
values:

| Missing signal | Platform's value | Platform's own effort label |
|---|---|---|
| `<meta name="tdm-reservation" content="0">` | +33 pts | 2-min paste |
| `rel="alternate"` links to llms.txt / llms-full.txt / agents.md | +14 pts | 2-min paste |
| Speakable schema | +11 pts | 1-click generate |

The three signals already in place were not named on the panel.

## 6. Crawlers — PLATFORM

"42 of 42 AI crawlers can read your site", 100% access health. Each bot is marked ALLOWED
(a robots.txt parse) and ✓ REACHABLE. **"Reachable" means the platform's own crawler
reached the site from the platform's infrastructure.** It is not proof that GPTBot or
ClaudeBot from their own IP ranges are unblocked at the edge. As a robots.txt result this
is clean; there is no firewall in front of this site the way there is on justindyar.com.

## 7. The two-host question — UNRESOLVED, needs one command

- MEASURED HERE: all 26 canonical tags and all 25 sitemap `<loc>` values point at the
  apex, `michellesellslibertypark.com`, with no `www.`.
- MEASURED HERE: typing the apex URL into Chrome ends with the address bar on
  `www.michellesellslibertypark.com`, path preserved.
- MEASURED HERE: `performance.getEntriesByType("navigation")[0].redirectCount` reads **0**
  (expected for a cross-origin redirect without `Timing-Allow-Origin`, so inconclusive).
- MEASURED HERE: WebFetch retrieved `https://www.michellesellslibertypark.com/liberty-park.html`
  and reported **no redirect**, returning real page content from the apex.

**So: it is NOT established that the apex redirects to www.** Both hosts appear to answer.
Either way there is a real ambiguity worth closing, but the earlier Aug-19 note's framing
("the canonical points at a redirect") is not proven and should not be repeated until
someone runs `curl -I https://www.michellesellslibertypark.com/` from Cursor and reads the
status line and `Location` header. One command settles it.

## 8. Content-side observations — MEASURED HERE

- Homepage `<title>` is 80 characters; homepage `<meta name="description">` is 205
  characters. `liberty-park.html` title is 64. These are character counts, nothing more —
  Google truncates on rendered pixel width and rewrites titles freely, so this is a
  tidiness item, not a measured loss.
- Four legal pages carry descriptions of 45–56 characters, all of the boilerplate form
  "X for michellesellslibertypark.com."
- `privacy-policy.html` has zero `<h2>` and jumps from `<h1>` to deeper levels.
- `property.html` has no `<h1>` and is not listed in sitemap.xml. It is the MLS detail
  template, so its absence from the sitemap may well be deliberate.
- `about-us.html`, `our-story.html`, `giving-back.html` and `join-the-team.html` describe
  ARC Realty generically. `about-us.html`'s meta description is brokerage copy — "ARC
  Realty offers residential real estate services throughout Birmingham and Montgomery,
  AL" — and never mentions Michelle, Liberty Park or Vestavia Hills. On a site whose whole
  point is Michelle-in-Liberty-Park, four pages pull the entity toward the brokerage.

## 9. The AI Syndicate Service node — a standing decision, flagged not condemned

The homepage JSON-LD carries a `Service` node named "GEO Optimization —
michellesellslibertypark.com", serviceType "Generative Engine Optimization (GEO)", with
AI Syndicate as `provider` and a paragraph describing AI Syndicate's business, dated
2026-08-18.

This is the house credit standard — the same credit is on all 26 pages and the equivalent
line on Shiner's llms.txt was kept on Ryder's explicit call. It is not a mistake.

The tradeoff to weigh, stated plainly: this is a second company's service offering sitting
inside the client's own entity graph, on a site whose Identity front already scores 55 and
whose canonical name is being read as the wrong company. An engine parsing that graph sees
a real-estate agent, a brokerage, and a GEO agency's service. Whether the credit is worth
that is Ryder's call, not this file's.

## 10. Notion state, read 2026-08-25

**Done:** signed agreement · first payment · draft site · IDX/MLS integration · domain
linked · week 1 baseline audit and file integration.

**In Progress:** "Get access to GoDaddy / web hosting platform" — its note still says the
domain resolves to the old ARC template site at 8.43.189.195, which is stale; the site is
live. "IDX feed — photos LIVE; domain cutover is the last step" — its note also says the
domain is the only remaining work, also stale.

**Still open and blocked on someone else:** the GALMLS IDX disclaimer wording has never
been checked against the signed agreement (BAR ticket #113466), and an HTML comment saying
so is still in all 26 pages while the domain is public.

Nothing in Notion covers weeks 2–8. The proposed track in `GEO-BASELINE-2026-08-19.md` was
never turned into tasks.

## 11. Not measured this session

- **SEO access** — the pane wedged the browser tab on three attempts. No SEO number was
  read, and none should be quoted.
- **Security Access, Brand intel, Reputation, Local, Authority, Hallucination watch** — not
  run. Each burns a scan run and none was asked for.
- No screenshot file was saved. The platform numbers here were read from the page's own
  rendered text, not from an image.

