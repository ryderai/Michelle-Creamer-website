# Third deploy — 2026-09-14 (evening)

## What the second deploy taught us — the real root cause, at last

The second deploy answered the question I could not answer by reading code. `?debug=1` now
reports `mlsFilterableFields`, and it said:

    rejected: ["UnparsedAddress"]
    usable:   ["City","PostalCode","SubdivisionName","StreetName"]
    contains: true      startswith: true

Two things fell out of that, both measured on the live endpoint:

1. **`contains()` is NOT broken.** My first diagnosis was wrong. `contains(City,'HOOVER')`
   returns 200.
2. **`UnparsedAddress` cannot be named in a filter at all** — 500, any operator.

And then the decisive measurement:

    (PostalCode eq '35242' or contains(PostalCode,'35242'))            -> 200 OK, 8.8s, rows
    (contains(City,..) or contains(SubdivisionName,..) or contains(StreetName,..))
                                                                       -> 500 in 767ms

**One `contains()` per filter is fine. Two or more OR'd together are refused outright** — in
under a second, so this is the server rejecting the shape of the query, not timing out on the
work. That is the actual bug, and it explains every failure from the start: the original code
OR'd four `contains()` together, and my eq-only rewrite OR'd three `eq` clauses that included
the poisoned `UnparsedAddress`.

## What this deploy does

The text search stops trying to say everything in one filter. It asks **one small, proven
question per field, in parallel, and merges the answers** (`textSearchRows`). Total wait is
the slowest single query rather than the sum, and every query sent is a shape this server has
already answered. Field list and operator both come from the runtime probe, so if Paragon
fixes `UnparsedAddress` the site starts using it with no code change.

## Two rounds of review found 23 defects in my own fix. All fixed.

The first pass found 11, including: **a word search silently discarded every price, bedroom
and bathroom filter** (the original bug in miniature); the zero-result escalation dropped the
luxury price floor so `luxury.html` could serve sub-$1M homes; a total MLS outage rendered as
"no listings match"; `searchLimited` was always true and therefore meaningless; merged results
were never re-sorted, so "price: low to high" returned three concatenated runs; and the
windowed total was invented (`72 properties` for a city with thousands).

The second pass found 12 more, including **a query the parser could not read — `!!!`, a
non-Latin script, or two single letters — still returned page one of the entire MLS**. That
is the original bug, in a new disguise, in my own fix. Also: a bare zip search had become
capped at 300 rows; `?beds=1&beds=2` was read as "12+ bedrooms"; a 3-bath home was excluded
from a 2-bath search when the MLS left the total column null; and dead code was still sitting
there able to emit the exact filter shape the server refuses.

**Tests: 267 checks** (81 logic + 186 endpoint), every one of the 23 defects covered by a
regression. The fake MLS now reproduces the real server exactly: `contains()` works, more than
one per filter is refused, `UnparsedAddress` is poisoned.

## Timing, since each MLS query takes 1-12 seconds

Each wave below is parallel, so it costs its slowest query. `maxDuration` is 60s.

| Scenario | Worst case |
|---|---|
| Warm word search | 12s |
| Cold word search | 36s |
| Cold word search, contains unsupported | 48s |
| Cold word search + type filter | 48s |
| Every term misses | 39s (capped by a 15s fan-out deadline) |

## Deploy

1. `cd ~/Documents/AI-Syndicate/Michelle-Creamer`
2. `node _tests/search-logic.test.mjs` — must say `0 failed`
3. `node _tests/search-endpoint.test.mjs` — must say `0 failed`
4. `git add -A && git commit -m "Search: one contains() per filter - fan out per field and merge"`
5. `git push`
6. Tell me when Vercel is green.

## What I will check when it is live

Her address five ways; city, zip, subdivision and MLS-number searches; every dropdown option;
all four sorts; paging both directions; a nonsense search; a word search with price and
bedroom filters applied (the defect that nearly shipped twice); every listing page; a detail
page; the homepage box; and phone width. Plus `?debug=1` to confirm the probe result.
