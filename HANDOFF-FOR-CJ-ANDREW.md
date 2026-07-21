# Michelle Creamer Site — v2 Rebuild (Jul 21, 2026)

Full 1:1 rebuild matching the structure of michellesellslibertypark.com (her ARC template site), with a premium facelift: glass floating nav, refined typography (Fraunces + Inter), ink-navy/ivory/brass palette.

## How to preview
Run a local server from this folder (fetch() needs http, not file://):
```
python3 -m http.server 8080
```
Then open http://localhost:8080

## Pages (25) — mirrors her live site's nav exactly
Property Search: property-search, open-houses, new-construction, commercial, acreage-lots, luxury, home-buying-guide
Sell: my-home-value, marketing-your-home, market-trends
About ARC: about-us, our-story, relocation, giving-back, press, join-the-team
Communities: communities, liberty-park
Plus: index, blog, contact-me, and 4 legal pages (privacy, DMCA, fair housing, accessibility)

## Property detail pages (added Jul 21)
`property.html` is a dynamic template — every listing gets a full page at `property.html?id=<id>` (or `?mls=<mls#>`) automatically, including anything the live feed adds later. Section skeleton mirrors her real ARC detail pages: gallery (pulls MLS photos _1.._12 from the ARC CDN pattern) → address/price/facts → Request Info/Schedule Showing form → listing agent → General/Interior/Exterior/Size & Lot/Schools/Utilities → Google Map → mortgage calculator → similar listings. 766 Hampden has real scraped remarks + details as the demo of a fully-populated page; the rest show graceful "arrives with the live feed" notes. Listing cards site-wide now link into these pages. When mapping the live feed, put MLS remarks in `description` and section data in `details` (see normalizeListing in js/listings.js).

## Login / Register + Saved Homes (added Jul 21)
Replaces Burrow's Login/Register with our own lead engine (`js/account.js`):
- "Login / Register" appears in the nav on every page → glass modal (Register: name/email/phone/interest, no password; Sign In: email recognition on that device)
- Every registration is a captured LEAD (preview mode logs to console — same as the forms)
- Registered visitors can heart-save listings (heart on every card); "Saved Homes" lives under their name in the nav → property-search.html?saved=1
- Tapping a heart while signed out opens the Register modal — that's the lead hook
- FOR ANDREW: set `AUTH_API.mode="live"` + endpoint at the top of js/account.js — register/signin/save events then POST as JSON (`{action, ...data}`). Accounts are per-browser (localStorage) until a real backend exists.

## Live MLS feed — FOR ANDREW
Everything listing-related renders through `js/listings.js`.
- Today it reads `data/listings.json` (27 real Michelle listings — actives + solds pulled from public feeds Jul 2026).
- To go live: in `js/listings.js`, set `LISTINGS_API.mode = "live"`, add `endpoint` + `apiKey`, and map field names in `normalizeListing()`. No page changes needed.

## Real data status (updated Jul 21, second pass)
**REAL (pulled from her live site via browser):** all 12 active/pending/contingent listings now use her real MLS photos (cdn.datafloat.com/ARC_PUBLIC/MLSPhotos) and real GALMLS numbers. Kenmore price updated to $2,100,000 (reduced $99,900 on her site). Added her real rental listing (4205 Vestview Circle, $3,200/mo, MLS 21458347). Removed 3 listings no longer in her live inventory (4717 Jackson Loop + 2 lots).

## Placeholders that still need real data before launch
1. **Sold listings (10)** — stock photos + placeholder MLS numbers; her sold-properties page is bot-gated (CAPTCHA), grab manually or wait for the feed
2. **Open house dates/times** — invented (Jul 26 / Aug 2)
3. **2 commercial listings + Bray townhome sample** — fabricated; blurbs say PLACEHOLDER
4. **`MICHELLE_EMAIL` in js/main.js** — blank (preview mode: leads log to console). Confirm her email with CJ.
5. **Headshot + listing photos hotlinked from ARC CDN** — fine for preview; self-host before launch
6. **Legal pages** — compliant drafts, need broker/legal review
7. **Community card stats** (listing counts) — hardcoded, will drift until wired to the feed
8. **Hero + community/blog imagery** — still premium stock (her ARC template has no equivalent custom photography)

## Intentionally NOT installed (per Ryder, Jul 21)
GEO package (schema, llms.txt, agents.md, meta tags, .md endpoints, sitemap, robots, footer credit) — to be layered on in a later pass.

## Verified Jul 21
All 25 pages: HTML balanced, internal links resolve, CSS braces balanced, JS syntax clean (node --check), listings.json valid, every page filter renders cards (featured 12 / sold 10 / open houses 3 / new construction 2 / commercial 2 / lots 3 / luxury 1). Stock images not verifiable from sandbox — eyeball in browser.
