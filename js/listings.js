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
  mode: "local",                 // "local" = data/listings.json | "live" = real feed
  localPath: "data/listings.json",
  endpoint: "",                  // e.g. https://api.mlsgrid.com/v2/Property?...
  apiKey: "",                    // provided by Andrew when the feed is licensed
  headers: {}                    // extra auth headers if the feed needs them
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
    photo: raw.photo,
    blurb: raw.blurb || "",
    description: raw.description || "",   // full MLS remarks (live feed: map to PublicRemarks)
    details: raw.details || null          // detail sections (live feed: map to feed fields)
  };
}

let _cache = null;

async function fetchListings() {
  if (_cache) return _cache;
  try {
    let data;
    if (LISTINGS_API.mode === "live" && LISTINGS_API.endpoint) {
      const res = await fetch(LISTINGS_API.endpoint, {
        headers: Object.assign(
          LISTINGS_API.apiKey ? { Authorization: "Bearer " + LISTINGS_API.apiKey } : {},
          LISTINGS_API.headers
        )
      });
      data = await res.json();
      _cache = (data.value || data.listings || data).map(normalizeListing);
    } else {
      const res = await fetch(LISTINGS_API.localPath);
      data = await res.json();
      _cache = data.listings.map(normalizeListing);
    }
  } catch (err) {
    console.warn("[listings] could not load data:", err);
    _cache = [];
  }
  return _cache;
}

/* ---------- formatting helpers ---------- */
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
  return (
    '<article class="listing-card reveal">' +
      '<a class="lc-media" href="' + url + '">' +
        '<button class="lc-save' + (saved ? " on" : "") + '" data-id="' + l.id + '" aria-label="Save this home" title="Save this home">&#10084;</button>' +
        '<div class="lc-chips">' + chips.join("") + "</div>" +
        '<img src="' + l.photo + '" alt="' + l.address + ", " + l.city + " " + l.state + '" loading="lazy" onerror="this.remove()">' +
      "</a>" +
      '<div class="lc-body">' +
        '<div class="lc-price">' + fmtPrice(l.price) + (l.type === "rental" ? '<span style="font-size:15px;color:var(--text-soft)">/mo</span>' : "") + "</div>" +
        '<div class="lc-address">' + l.address + '<span class="city">' + l.city + ", " + l.state + " " + l.zip + "</span></div>" +
        '<div class="lc-specs">' + specs.join("") + "</div>" +
        '<div class="lc-mls">MLS# ' + l.mls.replace("PLACEHOLDER-", "") + " · Listed by Michelle Creamer, ARC Realty</div>" +
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

async function initListingGrids() {
  const grids = document.querySelectorAll("[data-listings]");
  if (!grids.length) return;
  const all = await fetchListings();

  grids.forEach((grid) => {
    const filter = grid.getAttribute("data-filter") || "all";
    const limit = parseInt(grid.getAttribute("data-limit") || "0", 10);

    const render = () => {
      let list = applyFilter(all, filter);
      // Saved Homes view: property-search.html?saved=1
      if (new URLSearchParams(window.location.search).get("saved") === "1" && filter === "all") {
        list = all.filter((l) => window.mcSaved && window.mcSaved.has(l.id));
        grid.setAttribute("data-empty", "No saved homes yet. Tap the heart on any listing to keep it here.");
        const head = document.querySelector(".page-hero h1");
        if (head) head.textContent = "Your Saved Homes";
      }
      const page = grid.closest("[data-listing-page]") || document;
      const searchBox = page.querySelector("[data-listing-search]");
      const sortSel = page.querySelector("[data-listing-sort]");
      const typeSel = page.querySelector("[data-listing-type]");
      if (searchBox && searchBox.value) list = searchListings(list, searchBox.value);
      if (typeSel && typeSel.value !== "all") list = list.filter((l) => l.type === typeSel.value);
      list = sortListings(list, sortSel ? sortSel.value : "");
      if (limit) list = list.slice(0, limit);
      grid.innerHTML = list.length ? list.map(listingCard).join("") : emptyState(grid.getAttribute("data-empty"));
      const count = page.querySelector("[data-results-count]");
      if (count) count.textContent = list.length + (list.length === 1 ? " property" : " properties");
      if (window.observeReveals) window.observeReveals(grid);
    };

    render();
    const page = grid.closest("[data-listing-page]") || document;
    ["data-listing-search", "data-listing-sort", "data-listing-type"].forEach((attr) => {
      const el = page.querySelector("[" + attr + "]");
      if (el) el.addEventListener(attr === "data-listing-search" ? "input" : "change", render);
    });
  });
}

document.addEventListener("DOMContentLoaded", initListingGrids);
