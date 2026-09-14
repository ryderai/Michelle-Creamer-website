# Search tests

Run from the repo root. No network, no MLS credentials needed.

    node _tests/search-logic.test.mjs      # query parsing + matching  (81 checks)
    node _tests/search-endpoint.test.mjs   # whole endpoint end to end (80 checks)

`_extracted-logic.mjs` is generated — regenerate it after editing the parsing or
matching functions in `api/listings.js`:

    node _tests/regen.mjs

`fake-mls.mjs` is a stand-in for Greater Alabama MLS that reproduces the real
server's behaviour: HTTP 500 on any $filter containing contains(). That is the
fault that broke search in September 2026, so the tests fail if anyone
reintroduces a contains()-based filter.

These are excluded from the Vercel deploy by .vercelignore.
