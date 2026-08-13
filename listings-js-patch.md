# Patch for `js/listings.js`

Three edits. Search for the old text, replace with the new text. Nothing else in the file changes.

---

## Edit 1 — the config block (top of the file)

**FIND** (lines 12–18):

```js
const LISTINGS_API = {
  mode: "local",                 // "local" = data/listings.json | "live" = real feed
  localPath: "data/listings.json",
  endpoint: "",                  // e.g. https://api.mlsgrid.com/v2/Property?...
  apiKey: "",                    // provided by Andrew when the feed is licensed
  headers: {}                    // extra auth headers if the feed needs them
};
```

**REPLACE WITH:**

```js
const LISTINGS_API = {
  mode: "live",                  // "local" = data/listings.json | "live" = real feed
  localPath: "data/listings.json",
  endpoint: "/api/listings",     // our own serverless proxy — see api/listings.js
  apiKey: "",                    // INTENTIONALLY EMPTY. The MLS credential lives
                                 // server-side in Vercel env vars, never here.
  headers: {}
};
```

---

## Edit 2 — `normalizeListing()`

The proxy already returns the site's exact shape, so this becomes a pass-through
plus the new attribution fields.

**FIND** (the whole `normalizeListing` function, lines 23–45):

```js
function normalizeListing(raw) {
  return {
    id: raw.id,
    ...
    details: raw.details || null
  };
}
```

**REPLACE WITH:**

```js
function normalizeListing(raw) {
  return {
    id: raw.id,
    status: raw.status,
    address: raw.address,
    city: raw.city,
    state: raw.state,
    zip: raw.zip,
    price: raw.price,
    beds: raw.beds,
    baths: raw.baths,
    sqft: raw.sqft,
    type: raw.type,
    community: raw.community,
    mls: raw.mls,
    luxury: !!raw.luxury,
    newConstruction: !!raw.newConstruction,
    openHouse: raw.openHouse || null,
    photo: raw.photo,
    photos: raw.photos || [],
    blurb: raw.blurb || "",
    description: raw.description || "",
    details: raw.details || null,

    // IDX attribution — required on display. Falls back to Michelle
    // so the local preview data still renders correctly.
    listOffice: raw.listOffice || "ARC Realty",
    listAgent:  raw.listAgent  || "Michelle Creamer",
    listOfficePhone: raw.listOfficePhone || ""
  };
}
```

---

## Edit 3 — the attribution line on every card **(this one is a compliance fix)**

Right now every card hardcodes "Listed by Michelle Creamer, ARC Realty." That was
fine when the only data was Michelle's own 27 listings. The moment the live feed
turns on, the site starts claiming other brokers' listings as hers — which is a
false attribution and a direct violation of NAR IDX Policy 7.58.

**FIND** (inside `listingCard`, around line 120):

```js
        '<div class="lc-mls">MLS# ' + l.mls.replace("PLACEHOLDER-", "") + " · Listed by Michelle Creamer, ARC Realty</div>" +
```

**REPLACE WITH:**

```js
        '<div class="lc-mls">MLS# ' + l.mls.replace("PLACEHOLDER-", "") +
          " · Listed by " + (l.listAgent || "Michelle Creamer") +
          (l.listOffice ? ", " + l.listOffice : "") + "</div>" +
```

---

## Also add — the source disclaimer

Every page that displays listings needs a source-of-data line. Add this once to the
footer partial (or to each listing page's footer), just above the AI Syndicate credit:

```html
<p class="idx-disclaimer">
  Listing data courtesy of Greater Alabama MLS. Information is deemed reliable
  but is not guaranteed accurate by the MLS or Michelle Creamer. Listings held by
  brokerage firms other than ARC Realty are marked with the listing firm's name.
</p>
```

```css
.idx-disclaimer{
  font-size:11.5px; line-height:1.5; opacity:.55; text-align:center;
  max-width:760px; margin:24px auto 0; padding:0 20px;
}
```
