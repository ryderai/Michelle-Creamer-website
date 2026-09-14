# Second deploy — 2026-09-14

## What the first deploy taught us

The first fix went live and **half of it worked**:

- ✅ The property type dropdown now filters correctly (Single Family → 7,814 of 12,527;
  Commercial → 2,565). It reads the MLS's real vocabulary: `COMMERCIAL`, `Land`,
  `Residential`, `Residential Lease`, `Residential Income`.
- ✅ MLS-number search works. Zip search works. House-number search works.
- ✅ Nothing returns the unfiltered market any more.
- ❌ **Word searches ("boulder", "Vestavia Hills") still fail.**

## The diagnosis was wrong, and the live site proved it

I said the cause was `contains()`. **That was wrong.** Measured on the live endpoint today:

    contains(City,'HOOVER')     -> 200 OK
    startswith(City,'HOOVER')   -> 200 OK
    contains(PostalCode,'35242')-> 200 OK, returns rows

`contains()` works fine. What actually happens is that GALMLS **500s when a `$filter`
mentions certain FIELDS at all**, whatever operator is used — and one bad field kills the
whole query, including the parts that were fine.

That is why the original four-way OR failed: it named `City` and `PostalCode` (both fine)
alongside `UnparsedAddress` and `SubdivisionName`. And it is why my eq-only rewrite still
failed: it named `City` (fine) alongside `StreetName` and `SubdivisionName`.

| Field | Filterable? |
|---|---|
| `ListingKey`, `ListingId`, `PostalCode`, `StreetNumber` | ✅ measured working |
| `PropertyType`, `PropertySubType`, `ListPrice`, `BedroomsTotal` | ✅ measured working |
| `City` | ✅ measured working (contains AND startswith) |
| `UnparsedAddress`, `SubdivisionName`, `StreetName` | ❓ one or more of these is the poison |

## What this deploy changes

Instead of me guessing which of the three is bad, **the code asks the server.**
`textFields()` probes each doubtful field once per warm instance with a throwaway value,
caches the answer for 30 minutes, and only ever names fields that came back OK. It is
non-blocking — a visitor never waits for it, and until it answers the code uses only the
fields already proven good.

Two consequences worth knowing:

1. If Paragon fixes a field later, the site starts using it with no code change.
2. `?debug=1` now reports `mlsFilterableFields` — **after this deploy we will finally know
   which field is the culprit**, from measurement rather than deduction.

Also added: `searchLimited`. If the MLS refuses to narrow a search and we could only sift
the most recent 300 listings, a miss now says *"We could only check the most recently
updated listings — try a zip code or an MLS number"* instead of *"no match"*. A windowed
miss is not proof a property does not exist. A house-number miss still says a plain "no
match", because that search really is conclusive.

## Tests

184 checks now, including four new poison-field scenarios that fail the build if a single
refused field can break the whole search again.

    node _tests/search-logic.test.mjs      # 81
    node _tests/search-endpoint.test.mjs   # 103

## Deploy

1. `cd ~/Documents/AI-Syndicate/Michelle-Creamer`
2. `node _tests/search-logic.test.mjs` — must say `0 failed`
3. `node _tests/search-endpoint.test.mjs` — must say `0 failed`
4. `git add -A && git commit -m "Search: probe which MLS fields are filterable; one bad field no longer 500s the query"`
5. `git push`
6. Tell me when Vercel is green.
