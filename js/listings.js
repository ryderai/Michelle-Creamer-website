/* ============================================================
   Michelle Creamer — Listings Engine
   ------------------------------------------------------------
   HOW THE LIVE FEED HOOKS IN (for Andrew):
   Today this reads from data/listings.json (static preview data).
   When the IDX/MLS feed is ready, fill in LISTINGS_API below —
   set mode to "live", drop in the endpoint + key, and map the
   feed's field names inside normalizeListing(). Nothing else
   on any page needs to change.
   ============================================================ */

const LISTINGS_API = {
  mode: "live",                  // "local" = data/listings.json | "live" = real feed
  localPath: "data/listings.json",
  endpoint: "/api/listings",     // our own serverless proxy (api/listings.js) — holds the
                                 // Paragon/GALMLS credentials server-side, never in the browser
  apiKey: "",                    // INTENTIONALLY EMPTY — MLS creds live in Vercel env vars
  headers: {}
};

/* Map a raw feed record to the shape every page renders.
   For the local file this is pass-through; for a live feed,
   change the right-hand side to the feed's field names. */
function normalizeListing(raw) {
  return {
    id: raw.id,
    status: raw.status,                  // active | pending | under-contract | coming-soon | sold
    address: raw.address,
    city: raw.city,
    state: raw.state,
    zip: raw.zip,
    price: raw.price,
    beds: raw.beds,
    baths: raw.baths,
    sqft: raw.sqft,
    type: raw.type,                      // single-family | townhome | lot | commercial
    community: raw.community,
    mls: raw.mls,
    luxury: !!raw.luxury,
    newConstruction: !!raw.newConstruction,
    openHouse: raw.openHouse || null,
    photo: raw.photo || null,
    photos: raw.photos || [],
    // The MLS's own picture count. GALMLS refuses to send photos with the
    // listing record ($expand=Media returns 501), so pictures are fetched
    // separately from /api/media. This number tells us whether asking is
    // even worth it for a given listing.
    photosCount: raw.photosCount == null ? null : Number(raw.photosCount),
    blurb: raw.blurb || "",
    description: raw.description || "",   // full MLS remarks (live feed: PublicRemarks)
    details: raw.details || null,
    // IDX attribution — required on display; falls back to Michelle for local demo data
    listOffice: raw.listOffice || "ARC Realty",
    listAgent: raw.listAgent || "Michelle Creamer",
    listOfficePhone: raw.listOfficePhone || ""
  };
}

/* Two different lists, cached separately.
     agent — only Michelle's own listings (MLS_AGENT_MLS_ID in Vercel).
             This is what the homepage's Featured Listings should show.
     all   — every active listing in Greater Alabama MLS. This is what a
             Property Search page has to show: a buyer searching "Hoover" must
             find Hoover homes, not a dozen of Michelle's.
   A grid picks its list with data-scope="all" in the HTML; without it, a grid
   gets Michelle's own listings. */
const _cache = new Map();

/* When the MLS data in the page was pulled. Shown in the IDX disclaimer,
   because "deemed reliable" only means something if a visitor can see how
   fresh the data is. */
let _feedGeneratedAt = null;

function stampFeedFreshness() {
  const el = document.querySelector("[data-idx-updated]");
  if (!el || !_feedGeneratedAt) return;
  const d = new Date(_feedGeneratedAt);
  if (isNaN(d)) return;
  el.textContent = "Listing data last updated " +
    d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
    }) + " CT.";
  el.hidden = false;
}

async function fetchListings(scope) {
  scope = scope === "all" ? "all" : "agent";
  if (_cache.has(scope)) return _cache.get(scope);
  try {
    let data;
    if (LISTINGS_API.mode === "live" && LISTINGS_API.endpoint) {
      const url = LISTINGS_API.endpoint + (scope === "all" ? "?scope=all" : "");
      const res = await fetch(url, {
        headers: Object.assign(
          LISTINGS_API.apiKey ? { Authorization: "Bearer " + LISTINGS_API.apiKey } : {},
          LISTINGS_API.headers
        )
      });
      data = await res.json();
      _feedGeneratedAt = data.generatedAt || _feedGeneratedAt;
      _cache.set(scope, (data.value || data.listings || data).map(normalizeListing));
    } else {
      const res = await fetch(LISTINGS_API.localPath);
      data = await res.json();
      _cache.set(scope, data.listings.map(normalizeListing));
    }
  } catch (err) {
    console.warn("[listings] could not load data:", err);
    _cache.set(scope, []);
  }
  return _cache.get(scope);
}

/* ---------- formatting helpers ---------- */
/* MLS text (addresses, agent names) goes straight into HTML attributes here.
   A single stray quote in a feed record would otherwise break the markup, so
   escape it. */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtPrice = (n) => n == null ? "" : "$" + n.toLocaleString("en-US");
const fmtSqft = (n) => n == null ? "" : n.toLocaleString("en-US");
const STATUS_LABEL = {
  "active": "Active",
  "pending": "Pending",
  "under-contract": "Under Contract",
  "coming-soon": "Coming Soon",
  "sold": "Sold"
};
function fmtOpenHouse(oh) {
  if (!oh) return "";
  const d = new Date(oh.date + "T12:00:00");
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return day + " · " + oh.time;
}

/* ============================================================
   LISTING PHOTOS — second request, on purpose
   ------------------------------------------------------------
   GALMLS/Paragon will not send pictures with a listing record
   (`$expand=Media` answers 501 Not Implemented). So /api/listings
   returns every fact except the photos, and this block fetches
   photos from /api/media only for the cards a visitor can
   actually see, in batches, as they scroll.

   Why not just pull all ~200 up front? It would mean hundreds of
   extra MLS requests for pictures nobody looks at, and the page
   would sit blank while they finished.
   ============================================================ */
const MEDIA_API      = "/api/media";
const MEDIA_BATCH    = 12;    // keys per request — small enough that GALMLS never chokes
const MEDIA_DEBOUNCE = 80;    // ms to let a scroll burst gather before firing

const _photoCache = new Map();   // ListingKey -> array of photo urls (possibly empty)
const _photoQueue = new Set();   // keys waiting to be requested
const _photoAsked = new Set();   // keys already requested — never ask twice
let   _photoTimer = null;

/* Put the photo (or an honest "no photo" state) into every card for this key. */
function paintPhoto(key, urls) {
  document.querySelectorAll('[data-photo-key="' + CSS.escape(key) + '"]').forEach((slot) => {
    slot.classList.remove("loading");
    if (!urls || !urls.length) {
      slot.classList.add("noimg");
      slot.setAttribute("data-photo-state", "none");
      return;
    }
    /* The image is put into the page FIRST and revealed by CSS once it loads.
       It is deliberately not loading="lazy": a lazy image that is not yet in
       the document never starts loading in Chrome, so the photo would never
       appear. We already hold the request back with IntersectionObserver, so
       lazy loading here would add nothing anyway. */
    const img = document.createElement("img");
    img.alt = slot.getAttribute("data-photo-alt") || "";
    img.decoding = "async";
    img.addEventListener("load",  () => slot.setAttribute("data-photo-state", "ready"));
    img.addEventListener("error", () => {
      img.remove();
      slot.classList.add("noimg");
      slot.setAttribute("data-photo-state", "none");
    });
    slot.appendChild(img);
    img.src = urls[0];
  });
}

async function flushPhotoQueue() {
  _photoTimer = null;
  if (!_photoQueue.size) return;
  const keys = Array.from(_photoQueue).slice(0, MEDIA_BATCH);
  keys.forEach((k) => { _photoQueue.delete(k); _photoAsked.add(k); });

  try {
    const res = await fetch(MEDIA_API + "?keys=" + keys.map(encodeURIComponent).join(","));
    if (!res.ok) throw new Error("media endpoint returned " + res.status);
    const data = await res.json();
    const media = data.media || {};
    keys.forEach((k) => {
      const urls = media[k] || [];
      _photoCache.set(k, urls);   // [] here is a real answer: the MLS has no photo
      paintPhoto(k, urls);
    });
  } catch (err) {
    // A photo is not worth breaking a page over: show the neutral state and move
    // on. But do NOT cache the failure — an MLS hiccup must not turn into
    // "Photo not in MLS" for the rest of the visit. Let the next render retry.
    console.warn("[photos] could not load:", err);
    keys.forEach((k) => { _photoAsked.delete(k); paintPhoto(k, []); });
  }
  if (_photoQueue.size) schedulePhotoFlush();
}

function schedulePhotoFlush() {
  if (_photoTimer) return;
  _photoTimer = setTimeout(flushPhotoQueue, MEDIA_DEBOUNCE);
}

function queuePhoto(key) {
  if (_photoCache.has(key)) { paintPhoto(key, _photoCache.get(key)); return; }
  if (_photoAsked.has(key)) return;
  _photoQueue.add(key);
  schedulePhotoFlush();
}

/* Only ask for photos once a card is near the screen. */
let _photoObserver = null;
function watchPhotoSlots(root) {
  const slots = (root || document).querySelectorAll("[data-photo-key]:not([data-photo-watched])");
  if (!slots.length) return;

  if (!("IntersectionObserver" in window)) {
    slots.forEach((s) => { s.setAttribute("data-photo-watched", "1"); queuePhoto(s.getAttribute("data-photo-key")); });
    return;
  }
  if (!_photoObserver) {
    _photoObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        _photoObserver.unobserve(en.target);
        queuePhoto(en.target.getAttribute("data-photo-key"));
      });
    }, { rootMargin: "600px 0px" });   // start fetching before the card scrolls in
  }
  slots.forEach((s) => { s.setAttribute("data-photo-watched", "1"); _photoObserver.observe(s); });
}
window.watchPhotoSlots = watchPhotoSlots;

/* Full gallery for one listing (used by the property detail page). */
window.fetchListingPhotos = async function (key) {
  try {
    const res  = await fetch(MEDIA_API + "?keys=" + encodeURIComponent(key) + "&full=1");
    const data = await res.json();
    return (data.media && data.media[key]) || [];
  } catch (err) {
    console.warn("[photos] gallery unavailable:", err);
    return [];
  }
};

/* ---------- card renderer ---------- */
function listingCard(l) {
  const chips = [];
  chips.push('<span class="chip status-' + l.status + '">' + STATUS_LABEL[l.status] + "</span>");
  if (l.openHouse && l.status !== "sold") chips.push('<span class="chip open-house">Open ' + fmtOpenHouse(l.openHouse) + "</span>");
  if (l.newConstruction) chips.push('<span class="chip">New Construction</span>');
  if (l.luxury && l.status !== "sold") chips.push('<span class="chip">Luxury</span>');

  const specs = [];
  if (l.beds != null) specs.push("<span><b>" + l.beds + "</b> Beds</span>");
  if (l.baths != null) specs.push("<span><b>" + l.baths + "</b> Baths</span>");
  if (l.sqft != null) specs.push("<span><b>" + fmtSqft(l.sqft) + "</b> SqFt</span>");
  if (!specs.length) specs.push("<span><b>" + (l.type === "lot" ? "Homesite" : "Commercial") + "</b></span>");
  if (l.type === "rental") chips.push('<span class="chip">For Lease</span>');

  const url = "property.html?id=" + encodeURIComponent(l.id);
  const saved = window.mcSaved && window.mcSaved.has(l.id);
  const alt = esc(l.address + ", " + l.city + " " + l.state);

  /* The picture slot has three states:
       ready   — real MLS photo loaded
       loading — waiting on /api/media (GALMLS sends photos separately)
       none    — the MLS has no photo for this listing
     It never shows a stock house, because that would show the wrong building. */
  let media;
  if (l.photo) {
    media = '<img src="' + esc(l.photo) + '" alt="' + alt + '" loading="lazy" decoding="async" onerror="this.remove()">';
  } else if (l.photosCount === 0) {
    media = "";   // MLS says there is nothing to fetch
  } else {
    media = "";   // filled in by the photo loader above
  }
  const slotClass = "lc-media" +
    (l.photo ? "" : (l.photosCount === 0 ? " noimg" : " loading"));
  const slotAttrs = l.photo || l.photosCount === 0
    ? ' data-photo-state="' + (l.photo ? "ready" : "none") + '"'
    : ' data-photo-key="' + esc(l.id) + '" data-photo-alt="' + alt + '" data-photo-state="loading"';

  return (
    '<article class="listing-card reveal">' +
      '<a class="' + slotClass + '" href="' + url + '"' + slotAttrs + ">" +
        '<button class="lc-save' + (saved ? " on" : "") + '" data-id="' + esc(l.id) + '" aria-label="Save this home" title="Save this home">&#10084;</button>' +
        '<div class="lc-chips">' + chips.join("") + "</div>" +
        '<span class="lc-photo-note" aria-hidden="true"></span>' +
        media +
      "</a>" +
      '<div class="lc-body">' +
        '<div class="lc-price">' + fmtPrice(l.price) + (l.type === "rental" ? '<span style="font-size:15px;color:var(--text-soft)">/mo</span>' : "") + "</div>" +
        /* Every value below is MLS text going into innerHTML, so every one is
           escaped. An apostrophe in a street name or an angle bracket in an
           office name would otherwise break the card, and the feed is not
           ours to trust. */
        '<div class="lc-address">' + esc(l.address) +
          '<span class="city">' + esc(l.city) + ", " + esc(l.state) + " " + esc(l.zip) + "</span></div>" +
        '<div class="lc-specs">' + specs.join("") + "</div>" +
        '<div class="lc-mls">MLS# ' + esc(String(l.mls || "").replace("PLACEHOLDER-", "")) +
          " · Listed by " + esc(l.listAgent || "Michelle Creamer") +
          (l.listOffice ? ", " + esc(l.listOffice) : "") + "</div>" +
        '<div class="lc-cta"><a class="text-link" href="' + url + '">View Property</a></div>' +
      "</div>" +
    "</article>"
  );
}

/* ---------- page filters ----------
   Any element with [data-listings] becomes a grid.
   data-filter values:
     featured    → active + coming-soon + pending + under-contract (residential, capped by data-limit)
     sold        → sold only
     open-houses → has openHouse
     new-construction, commercial, lots, luxury → by flag/type
     all         → everything not sold
*/
function applyFilter(list, filter) {
  switch (filter) {
    case "featured":
      return list.filter((l) => l.status !== "sold" && l.type !== "commercial" && l.type !== "lot");
    case "sold":
      return list.filter((l) => l.status === "sold");
    case "open-houses":
      return list.filter((l) => l.openHouse && l.status !== "sold");
    case "new-construction":
      return list.filter((l) => l.newConstruction && l.status !== "sold");
    case "commercial":
      return list.filter((l) => l.type === "commercial" && l.status !== "sold");
    case "lots":
      return list.filter((l) => l.type === "lot" && l.status !== "sold");
    case "luxury":
      return list.filter((l) => l.luxury && l.status !== "sold");
    case "all":
      return list.filter((l) => l.status !== "sold");
    default:
      return list;
  }
}

function sortListings(list, mode) {
  const arr = list.slice();
  if (mode === "price-desc") arr.sort((a, b) => (b.price || 0) - (a.price || 0));
  if (mode === "price-asc") arr.sort((a, b) => (a.price || 0) - (b.price || 0));
  if (mode === "sqft-desc") arr.sort((a, b) => (b.sqft || 0) - (a.sqft || 0));
  return arr;
}

function searchListings(list, q) {
  if (!q) return list;
  const t = q.toLowerCase();
  return list.filter((l) =>
    [l.address, l.city, l.zip, l.community, l.mls, l.type].join(" ").toLowerCase().includes(t)
  );
}

function emptyState(msg) {
  return (
    '<div class="listing-empty" style="grid-column:1/-1">' +
      "<h3>No matching properties right now</h3>" +
      "<p>" + (msg || "Inventory moves fast in this market. Reach out and Michelle will let you know the moment something fits — including off-market opportunities.") + "</p>" +
      '<a class="btn brass" href="contact-me.html">Contact Michelle</a>' +
    "</div>"
  );
}

/* ============================================================
   GRID INITIALISATION — two very different jobs
   ------------------------------------------------------------
   A grid WITHOUT data-scope shows Michelle's own listings. There
   are about a dozen, so they are fetched once and filtered in the
   browser. Fast, and the filters feel instant.

   A grid WITH data-scope="all" is a search of the whole MLS —
   12,620 listings. Those cannot be held in the browser, so the
   search terms, the sort and the page number are sent to the MLS
   and one page comes back at a time. Every listing is reachable.
   ============================================================ */

/* data-filter on a market grid becomes MLS query parameters. */
const SERVER_FILTER_PARAMS = {
  "luxury":           { luxury: "1" },
  "commercial":       { type: "commercial" },
  "lots":             { type: "lot" },
  "new-construction": { newConstruction: "1" },
  "open-houses":      { openHouse: "1" },
  "all":              {}
};

function pagerHtml(page, pageSize, total, returned, hasMore, countKnown) {
  const from = returned ? (page - 1) * pageSize + 1 : 0;
  const to   = (page - 1) * pageSize + returned;
  const last = Math.max(Math.ceil(total / pageSize), 1);

  /* The MLS total is fetched separately and cached. If it is briefly
     unavailable, paging still works — the pager just stops promising a total
     rather than printing a number it does not have. */
  let label;
  if (!returned) label = "No matching properties";
  else if (countKnown === false) {
    label = "Showing <b>" + from.toLocaleString("en-US") + "&ndash;" + to.toLocaleString("en-US") + "</b>" +
            '<span class="lc-pager-page">Page ' + page + "</span>";
  } else {
    label = "Showing <b>" + from.toLocaleString("en-US") + "&ndash;" + to.toLocaleString("en-US") +
            "</b> of <b>" + total.toLocaleString("en-US") + "</b>" +
            '<span class="lc-pager-page">Page ' + page + " of " + last.toLocaleString("en-US") + "</span>";
  }

  return (
    '<div class="lc-pager">' +
      '<button class="btn ghost sm" data-page-prev' + (page <= 1 ? " disabled" : "") + ">&larr; Previous</button>" +
      '<span class="lc-pager-count">' + label + "</span>" +
      '<button class="btn ghost sm" data-page-next' + (hasMore ? "" : " disabled") + ">Next &rarr;</button>" +
    "</div>"
  );
}

/* ---------- a grid backed by the whole MLS ---------- */
function initServerGrid(grid) {
  const page   = grid.closest("[data-listing-page]") || document;
  const filter = grid.getAttribute("data-filter") || "all";
  const limit  = parseInt(grid.getAttribute("data-limit") || "0", 10);
  const pageSize = limit || 24;

  const searchBox = page.querySelector("[data-listing-search]");
  const sortSel   = page.querySelector("[data-listing-sort]");
  const typeSel   = page.querySelector("[data-listing-type]");
  const countEl   = page.querySelector("[data-results-count]");

  let pageNo = 1, inFlight = 0;

  const pager = document.createElement("div");
  pager.className = "lc-pager-wrap";
  if (!limit) grid.insertAdjacentElement("afterend", pager);

  const buildUrl = () => {
    const qs = new URLSearchParams({ scope: "all", page: String(pageNo), pageSize: String(pageSize) });
    Object.entries(SERVER_FILTER_PARAMS[filter] || {}).forEach(([k, v]) => qs.set(k, v));
    if (searchBox && searchBox.value.trim()) qs.set("q", searchBox.value.trim());
    if (typeSel && typeSel.value && typeSel.value !== "all") qs.set("type", typeSel.value);
    if (sortSel && sortSel.value) qs.set("sort", sortSel.value);
    return LISTINGS_API.endpoint + "?" + qs.toString();
  };

  const render = async () => {
    const ticket = ++inFlight;               // ignore answers from stale requests
    grid.setAttribute("aria-busy", "true");
    if (countEl) countEl.textContent = "Searching…";

    let data = { listings: [], total: 0 };
    try {
      const res = await fetch(buildUrl());
      data = await res.json();
      if (data.generatedAt) { _feedGeneratedAt = data.generatedAt; stampFeedFreshness(); }
    } catch (err) {
      console.warn("[listings] search failed:", err);
    }
    if (ticket !== inFlight) return;         // a newer search already answered

    const list = (data.listings || []).map(normalizeListing);
    grid.removeAttribute("aria-busy");
    grid.innerHTML = list.length
      ? list.map(listingCard).join("")
      : emptyState(grid.getAttribute("data-empty"));

    if (countEl) {
      countEl.textContent = (data.total || 0).toLocaleString("en-US") +
        ((data.total === 1) ? " property" : " properties");
    }

    if (!limit) {
      pager.innerHTML = list.length || pageNo > 1
        ? pagerHtml(data.page || pageNo, data.pageSize || pageSize, data.total || 0,
                    list.length, Boolean(data.hasMore), data.countKnown)
        : "";
      const prev = pager.querySelector("[data-page-prev]");
      const next = pager.querySelector("[data-page-next]");
      if (prev) prev.addEventListener("click", () => { if (pageNo > 1) { pageNo--; render(); scrollToGrid(); } });
      if (next) next.addEventListener("click", () => { if (data.hasMore) { pageNo++; render(); scrollToGrid(); } });
    }

    /* If the MLS refused part of the search we say so, rather than quietly
       showing results that do not match what was typed. */
    const warn = page.querySelector("[data-filter-warning]");
    if (warn) {
      warn.textContent = data.droppedFilters
        ? "Some of your filters could not be applied by the MLS, so these results are broader than you asked for."
        : "";
      warn.hidden = !data.droppedFilters;
    }

    if (window.observeReveals) window.observeReveals(grid);
    watchPhotoSlots(grid);
  };

  const scrollToGrid = () => {
    const top = grid.getBoundingClientRect().top + window.scrollY - 120;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const reset = () => { pageNo = 1; render(); };

  let typingTimer = null;
  if (searchBox) searchBox.addEventListener("input", () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(reset, 350);   // wait for them to stop typing
  });
  if (sortSel) sortSel.addEventListener("change", reset);
  if (typeSel) typeSel.addEventListener("change", reset);

  render();
}

/* ---------- a grid backed by Michelle's own listings ---------- */
async function initAgentGrid(grid) {
  const all = await fetchListings("agent");
  stampFeedFreshness();

  const filter = grid.getAttribute("data-filter") || "all";
  const limit  = parseInt(grid.getAttribute("data-limit") || "0", 10);
  const page   = grid.closest("[data-listing-page]") || document;

  const render = () => {
    let list = applyFilter(all, filter);

    // Saved Homes view: property-search.html?saved=1
    if (new URLSearchParams(window.location.search).get("saved") === "1" && filter === "all") {
      list = all.filter((l) => window.mcSaved && window.mcSaved.has(l.id));
      grid.setAttribute("data-empty", "No saved homes yet. Tap the heart on any listing to keep it here.");
      const head = document.querySelector(".page-hero h1");
      if (head) head.textContent = "Your Saved Homes";
    }

    const searchBox = page.querySelector("[data-listing-search]");
    const sortSel   = page.querySelector("[data-listing-sort]");
    const typeSel   = page.querySelector("[data-listing-type]");
    if (searchBox && searchBox.value) list = searchListings(list, searchBox.value);
    if (typeSel && typeSel.value !== "all") list = list.filter((l) => l.type === typeSel.value);
    list = sortListings(list, sortSel ? sortSel.value : "");
    if (limit) list = list.slice(0, limit);

    /* Some sections only make sense when they have listings — "Recently Sold"
       is one. The MLS feed carries active and pending homes only, so that
       grid is empty until sold data is licensed. Hide the whole section
       rather than show a visitor an empty shelf. */
    const hideWrap = grid.hasAttribute("data-hide-if-empty")
      ? (grid.closest("section") || grid)
      : grid.closest("[data-hide-if-empty]");
    if (hideWrap) hideWrap.style.display = list.length ? "" : "none";

    grid.innerHTML = list.length ? list.map(listingCard).join("") : emptyState(grid.getAttribute("data-empty"));
    const count = page.querySelector("[data-results-count]");
    if (count) count.textContent = list.length + (list.length === 1 ? " property" : " properties");
    if (window.observeReveals) window.observeReveals(grid);
    watchPhotoSlots(grid);
  };

  render();
  ["data-listing-search", "data-listing-sort", "data-listing-type"].forEach((attr) => {
    const el = page.querySelector("[" + attr + "]");
    if (el) el.addEventListener(attr === "data-listing-search" ? "input" : "change", render);
  });
}

async function initListingGrids() {
  const grids = Array.prototype.slice.call(document.querySelectorAll("[data-listings]"));
  if (!grids.length) return;
  await Promise.all(grids.map((grid) =>
    grid.getAttribute("data-scope") === "all"
      ? Promise.resolve(initServerGrid(grid))
      : initAgentGrid(grid)
  ));
}

document.addEventListener("DOMContentLoaded", initListingGrids);
