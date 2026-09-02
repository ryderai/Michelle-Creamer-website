# Michelle Creamer — Week 2 RESULT (after the push)
**Measured 2026-08-25, after Ryder pushed and Vercel deployed.**
Before-numbers come from `GEO-RESCAN-2026-08-25.md` (same day, pre-push).
Build detail: `GEO-WEEK2-BUILD-2026-08-25.md`.

## The score

**AI Access 82 → 98 / 100.** Platform label: "▲ +12 since last audit", 7 audits Aug 19 → Aug 25.
(The platform's per-front delta labels do not reconcile with the before-numbers we recorded —
e.g. it prints "+33" on structured data, which was 38. Quote the absolute before/after from our
own record, not the platform's arrows.)

| Front | Before (pre-push, same day) | After |
|---|---|---|
| **AI Access overall** | **82** | **98** |
| Structured data | 38 | **100** |
| AI intent & permission | 42 | **100** |
| Page content quality | 76 | **98** |
| Identity (NAP) | 55 | **63** |
| AI crawler access | 100 | 100 |
| Sitemap | 100 | 100 |
| llms.txt & agents | 100 | 100 |
| robots.txt | 100 | 100 |
| Crawlability | 100 | 100 |

**Page audit: 25 pages, average AI score 76 → 98.**
Most-common issues before: `no-md-alternate` 25, `no-semantic-html` 25, `no-main` 25,
`no-author` 24. After: `few-h2` 9, `missing-expected-schema` 4. Everything else cleared.

## The identity fix worked — this is the proof

The NAP panel now reads:

- **Canonical business name: "Michelle Creamer"** — it read **"ARC Realty"** before.
- **ADDRESS: 3215 Endeavor Lane Suite 113, Vestavia Hills, AL 35242** — it read
  "Not published" before.
- **LINKED SOCIAL PROFILES: all 5** listed — none were recognised before.

External citation probe, before → after:
- **Google Business Profile: POSSIBLE MATCH (ARC Realty) → VERIFIED**
- **Facebook: POSSIBLE MATCH (facebook.com/arcrealtyal) → VERIFIED**
- Instagram and Yelp still POSSIBLE MATCH; LinkedIn, BBB, OpenStreetMap moved from
  POSSIBLE MATCH (all ARC's) to NOT FOUND — the site no longer resolves to the brokerage's
  listings, which is the correct outcome. Clutch, Foursquare still NOT FOUND.

"VERIFIED" is the platform's word for *proved this listing is hers*. That is the finding from
this morning closing.

## Exposure: CLOSED and proven

All six internal documents now return **404** on the live site, each fetched individually:
`GEO-BASELINE-2026-08-19.md` (Ryder confirmed in Chrome), `GO-LIVE-MONDAY.md`,
`HANDOFF-FOR-CJ-ANDREW.md`, `listings-js-patch.md`, `GEO-RESCAN-2026-08-25.md`,
`GEO-WEEK2-BUILD-2026-08-25.md`. The `vercel.json` rewrite is what did it, as expected —
`.vercelignore` alone would not have.

## The www question: SETTLED

`curl -I https://www.michellesellslibertypark.com/` returned:

```
HTTP/2 308
location: https://www.michellesellslibertypark.com/
server: Vercel
```

**The apex 308-redirects to www.** So the site really does serve on www only, and
**all 26 canonical tags and all 25 sitemap `<loc>` values point at the apex, which is a
redirect.** The Aug 19 note was right after all; this session's scan could not prove it
because WebFetch and `navigation.redirectCount` both hid it. One `curl -I` settled it.

This is now a known, unfixed defect. It did not stop the score reaching 98, but every page is
telling search and AI engines the canonical version lives on a host that immediately bounces.

## What is left, in order

1. **Canonical host.** Point all 26 canonicals, all 25 sitemap `<loc>` values and every
   `og:url` at `https://www.michellesellslibertypark.com/…`. Purely mechanical.
2. **Identity 63/100 — two cross-page conflicts the panel now names:**
   - **Business name, HIGH:** "Michelle Creamer" and "ARC Realty" both appear as names on the
     homepage. Both are true — she is an agent at that brokerage — but the panel counts it as a
     conflict. Worth trying: keep ARC as `parentOrganization` only and see whether removing its
     `name` collision moves the score. Test it, do not assume.
   - **Phone, MED:** `+1-205-730-2359` (office, on the business node) vs `+1-205-999-8164`
     (mobile, on the Person node). Both are real and both are published on her site. Likely
     fix: one primary `telephone` plus a `contactPoint` typed as mobile.
3. **`few-h2` on 9 pages** — thin pages with fewer than three `<h2>` headings. Needs real
   subheadings, which means real content, which is a copy decision.
4. **`missing-expected-schema` on 4 pages** — the panel expects a more specific type on some
   pages (blog wants `BlogPosting` items, contact-me wants `ContactPage`, press wants article
   items). Small and mechanical.
5. Not measured this session: SEO access, Security, Brand intel, Reputation, Local, Authority,
   Hallucination watch. Each burns a scan run; none was asked for.

## Notes for whoever picks this up

- The workspace card was on `shinerlawgroup.com` when this ran, and was left there. The AI
  access `YOUR DOMAIN` dropdown was used, so the workspace was not moved.
- Chrome's `fetch()` inside a page on Michelle's own origin **hung repeatedly** this session
  and wedged the tab, though it worked earlier the same day. Navigating to each page and
  reading `document` worked fine. WebFetch worked for the `.md` files and the 404 checks.

---

## Filed in Notion, 2026-08-25

Three rows created in 📋 Operations, all Client = Michelle Creamer, Assigned To = Ryder,
Client Record linked, Phase = Month 1.

| Row | Status | Due | Priority |
|---|---|---|---|
| Week 2 — schema, AI signals and page structure across all 26 pages | **Done** | Aug 25 2026 | 🔴 High |
| Week 3 — point every canonical tag at the www host | To Do | Sep 1 2026 | 🔴 High |
| Week 3 — clear the 2 identity conflicts (NAP stuck at 63) | To Do | Sep 1 2026 | 🟡 Medium |

Each row's page body carries the full method, the proof, and the before-numbers to re-measure
against. The Week 3 canonical row also records the two in-browser checks that got the redirect
question **wrong**, so nobody re-litigates it from a browser.

Ryder will need ⌘R in Notion — it does not live-refresh rows added over the API.

## Two Operations rows are STALE and were left alone

Not touched, because nobody asked and they are someone else's record:

- **"Get access to GoDaddy / web hosting platform"** (In Progress)
- **"IDX feed — photos LIVE; domain cutover is the last step"** (In Progress)

Both still say the domain resolves to the old ARC template site at `8.43.189.195`. It does not —
the site has been live on Vercel since before Aug 20, and Vercel's Domains panel now shows
`www.michellesellslibertypark.com` as Production with the apex and the `.vercel.app` address
both 308-redirecting into it. Whoever owns those rows should close or reword them.
