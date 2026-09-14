# Deploy the search fix — 2026-09-13

## What changed and why

Search on the site was returning a random slice of all 12,527 Alabama listings for every
term typed. Michelle could not find her own listing (4413 Boulder Lake Circle, MLS
21463762) because the results were real houses — just not the ones she asked for.

Cause: the Greater Alabama MLS answers **HTTP 500** to any filter containing `contains()`,
and our code built both the search box and the type dropdown out of `contains()`. When the
MLS refused, our code quietly dropped the search and served everything. The front end had a
warning for exactly this — pointing at an element that was never added to the page.

Full record: `~/Documents/Claude/Projects/AI syndicate/memory/michelle-search-contains-bug_2026-09-13.md`

## Files changed

| File | What |
|---|---|
| `api/listings.js` | Search and type filters rebuilt on `eq` only. Visitor's search is never dropped. Honest `searchUnavailable`. |
| `js/listings.js` | Truthful empty states and counts; handles a failed request; escapes the search term. |
| `property-search.html` + 5 listing pages | The warning element that was missing. |
| `css/styles.css` | Styles for that warning. |
| `_tests/` | 161 checks. New — excluded from the deploy. |
| `.vercelignore` | Excludes `_tests/`. |

## Before you push — run the tests (10 seconds, no credentials needed)

    cd ~/Documents/AI-Syndicate/Michelle-Creamer
    node _tests/search-logic.test.mjs
    node _tests/search-endpoint.test.mjs

Both must end with `0 failed`. If either fails, do not push — tell me what it printed.

## Deploy

1. Open the `Michelle-Creamer` folder in Cursor.
2. Open the terminal in Cursor.
3. Paste: `git add -A && git commit -m "Fix search: GALMLS 500s on contains(), rebuild filters on eq"`
4. Paste: `git push`
5. Vercel builds automatically. Watch it go green.
6. Tell me it's live and I will run the full test pass on the real site.

## What I will check once it is live

Nothing is "fixed" until these pass against the real MLS, not the fake one:

- Her address, five ways: `4413 Boulder Lake Cir`, `4413 Boulder Lake Circle`,
  `Boulder Lake`, `21463762`, `35242`
- City, subdivision and zip searches return only that city / subdivision / zip
- Every dropdown option: Single Family, Townhome / Condo, Acreage / Lots, Rentals, Commercial
- All four sorts, and paging forward and back with no repeats or skips
- A nonsense search says "no match" instead of listing houses
- Luxury, New Construction, Open Houses, Acreage and Commercial pages
- A property detail page, and the homepage search box
- Phone width
- How long a cold search takes

## The one thing to watch

The fix asks the MLS a question built only from `eq`. If Greater Alabama MLS ever starts
accepting `contains()`, the code detects that on its own and starts using it — no edit
needed. That probe is why `stringCaps()` exists.
