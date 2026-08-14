/* ============================================================
   Michelle Creamer — IDX feed proxy  (Vercel serverless function)
   ------------------------------------------------------------
   WHY THIS FILE EXISTS
   The website cannot call the MLS directly from the browser. The
   OAuth credential is a *confidential* client secret — putting it
   in front-end JS would publish AI Syndicate's MLS access to
   anyone who views source. IDX license terms also prohibit
   re-serving the raw feed publicly.

   WHY IT PAGES AND FILTERS SERVER-SIDE (rewritten Aug 13 2026)
   Greater Alabama MLS holds 12,620 active + pending listings.
   The old version asked for $top=200 and stopped, so the search
   page showed 1.6% of the market and called it a search.

   Sending all 12,620 to the browser is not the answer either —
   that is tens of megabytes and roughly 64 round trips to the
   MLS, well past a serverless function's time limit. So the
   filtering, sorting and paging all happen ON THE MLS, and the
   browser asks for one page at a time. Every listing is reachable;
   none of them are loaded needlessly.

   ENVIRONMENT VARIABLES (Vercel → Settings → Environment Variables)
     MLS_CLIENT_ID       e.g. AISCidx
     MLS_CLIENT_SECRET   the vendor password
     MLS_AGENT_MLS_ID    Michelle's agent ID (creamemi)

   ENDPOINT
     GET /api/listings                        → Michelle's own listings
     GET /api/listings?scope=all              → the whole MLS, page 1
     GET /api/listings?scope=all&q=hoover&page=2&pageSize=24
     GET /api/listings?debug=1                → counts + timing, no rows
     GET /api/listings?probe=1                → what the MLS accepts
   ============================================================ */

const TOKEN_URL    = "https://galmls.paragonrels.com/OData/GALMLS/identity/connect/token";
const SERVICE_ROOT = "https://galmls.paragonrels.com/OData/GALMLS/DD1.7";

const LUXURY_FLOOR    = 1000000;   // price at/above this gets the "Luxury" chip
const DEFAULT_PAGE    = 24;        // listings per page for a search
const MAX_PAGE        = 96;        // hard cap on pageSize a caller can ask for
const AGENT_MAX       = 200;       // one agent never has more than this
const CACHE_SECONDS   = 60 * 60 * 3;    // 3h — well inside the 12h IDX refresh floor

/* Statuses we display. Anything else (Withdrawn, Expired, Canceled,
   Hold, Incomplete, Delete) is intentionally excluded. */
const STATUS_MAP = {
  "Active":               "active",
  "ComingSoon":           "coming-soon",
  "Coming Soon":          "coming-soon",
  "Pending":              "pending",
  "ActiveUnderContract":  "under-contract",
  "Active Under Contract":"under-contract",
  "Closed":               "sold"
};

/* ---------- token cache (survives while the instance stays warm) ---------- */
let _token = null;

async function getToken() {
  if (_token && Date.now() < _token.expiresAt) return _token.value;

  const id     = process.env.MLS_CLIENT_ID;
  const secret = process.env.MLS_CLIENT_SECRET;
  if (!id || !secret) throw new Error("CONFIG: MLS_CLIENT_ID / MLS_CLIENT_SECRET are not set");

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type":  "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=OData"
  });

  // Deliberately does not echo the response body — it can contain the credential.
  if (!res.ok) throw new Error(`AUTH: token request failed (${res.status})`);

  const json = await res.json();
  if (!json.access_token) throw new Error("AUTH: no access_token in response");

  // Paragon has no auto-refresh and publishes no fixed TTL — trust expires_in,
  // and retire the token 60s early so we never race the expiry.
  const ttl = Number(json.expires_in) || 3600;
  _token = { value: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return _token.value;
}

/* ---------- OData GET with one automatic retry on a stale token ---------- */
async function odata(path, { retry = true } = {}) {
  const token = await getToken();
  const res = await fetch(`${SERVICE_ROOT}/${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
  });

  if (res.status === 401 && retry) {
    _token = null;                       // force a fresh token, try once more
    return odata(path, { retry: false });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ODATA ${res.status} on ${path.split("?")[0]}: ${body.slice(0, 220)}`);
  }
  return res.json();
}

/* ---------- field mapping: RESO Data Dictionary → the site's shape ---------- */

function mapType(raw) {
  const sub  = (raw.PropertySubType || "").toLowerCase();
  const main = (raw.PropertyType    || "").toLowerCase();

  if (main.includes("lease") || main.includes("rental")) return "rental";
  if (main.includes("commercial") || sub.includes("commercial") ||
      sub.includes("office") || sub.includes("retail") || sub.includes("warehouse")) return "commercial";
  if (main.includes("land") || sub.includes("land") ||
      sub.includes("lot") || sub.includes("unimproved") || sub.includes("acreage")) return "lot";
  if (sub.includes("townhouse") || sub.includes("townhome")) return "townhome";
  if (sub.includes("condominium") || sub.includes("condo")) return "condo";
  return "single-family";
}

function mapBaths(raw) {
  if (raw.BathroomsTotalInteger != null) return raw.BathroomsTotalInteger;
  const full = raw.BathroomsFull || 0;
  const half = raw.BathroomsHalf || 0;
  if (!full && !half) return null;
  return half ? full + 0.5 * half : full;
}

function normalize(raw, { lean = false } = {}) {
  const status = STATUS_MAP[raw.StandardStatus];
  if (!status) return null;                       // drop anything not displayable

  const price = raw.StandardStatus === "Closed"
    ? (raw.ClosePrice ?? raw.ListPrice)
    : raw.ListPrice;

  const out = {
    id:      String(raw.ListingKey || raw.ListingId),
    mls:     String(raw.ListingId  || raw.ListingKey),
    status,
    address: raw.UnparsedAddress || [raw.StreetNumber, raw.StreetDirPrefix, raw.StreetName, raw.StreetSuffix]
                                      .filter(Boolean).join(" "),
    city:    raw.City || "",
    state:   raw.StateOrProvince || "AL",
    zip:     raw.PostalCode || "",
    price:   price ?? null,
    beds:    raw.BedroomsTotal ?? null,
    baths:   mapBaths(raw),
    sqft:    raw.LivingArea ?? raw.BuildingAreaTotal ?? null,
    type:    mapType(raw),
    community: raw.SubdivisionName || "",

    luxury:          (price || 0) >= LUXURY_FLOOR,
    newConstruction: raw.NewConstructionYN === true,
    openHouse:       null,                        // filled in by attachOpenHouses()

    /* GALMLS rejects $expand=Media (501), so no picture arrives with the
       listing record. Deliberately null — NOT a stock house photo, which
       would show a visitor the wrong building. The browser fills these in
       from /api/media. photosCount is the MLS's own count, so the front end
       knows whether a photo request is even worth making. */
    photo:       null,
    photos:      [],
    photosCount: raw.PhotosCount ?? raw.PicturesCount ?? null,

    /* IDX attribution — REQUIRED on display for every listing that
       is not Michelle's own. See NAR IDX Policy 7.58. */
    listOffice:      raw.ListOfficeName   || "",
    listAgent:       raw.ListAgentFullName|| "",
    listOfficePhone: raw.ListOfficePhone  || "",
    listAgentMlsId:  raw.ListAgentMlsId   || "",

    modified: raw.ModificationTimestamp || null
  };

  /* PublicRemarks is by far the biggest field. A grid of cards never shows it,
     and carrying it would roughly triple the size of a search page. The detail
     page fetches its own listing, so it still gets the full text. */
  if (!lean) {
    out.blurb = "";
    out.description = raw.PublicRemarks || "";
    out.details = null;
  }
  return out;
}

/* ---------- turning URL parameters into an MLS query ---------- */

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const num = (v) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* Text search. GALMLS accepts contains(); this looks across the fields a
   person actually types into a property search. */
function textClause(text) {
  const t = String(text).trim().slice(0, 60);
  if (!t) return null;
  const fields = ["City", "PostalCode", "UnparsedAddress", "SubdivisionName"];
  return "(" + fields.map(f => `contains(${f},${q(t)})`).join(" or ") + ")";
}

/* Property type. These are tried against the MLS and dropped if rejected —
   see buildAttempts(). */
const TYPE_CLAUSE = {
  "lot":           "(contains(PropertyType,'Land') or contains(PropertySubType,'Lot') or contains(PropertySubType,'Acreage'))",
  "commercial":    "(contains(PropertyType,'Commercial') or contains(PropertySubType,'Commercial'))",
  "rental":        "(contains(PropertyType,'Lease') or contains(PropertyType,'Rental'))",
  "condo":         "(contains(PropertySubType,'Condo'))",
  "townhome":      "(contains(PropertySubType,'Town'))",
  "single-family": "(contains(PropertySubType,'Single'))"
};

const SORTS = {
  "newest":     "ModificationTimestamp desc",
  "price-desc": "ListPrice desc",
  "price-asc":  "ListPrice asc",
  "sqft-desc":  "LivingArea desc"
};

/* Only the fields the site actually renders. Without $select the MLS returns
   every column it has (well over a hundred) for every row, which it has to
   read, serialise and send. Asking for ~30 named fields is the single cheapest
   speed win available here. `lean` drops PublicRemarks, which is the largest
   field by far and is never shown on a card. */
const SELECT_CORE = [
  "ListingKey", "ListingId", "StandardStatus",
  "UnparsedAddress", "StreetNumber", "StreetDirPrefix", "StreetName", "StreetSuffix",
  "City", "StateOrProvince", "PostalCode",
  "ListPrice", "ClosePrice",
  "BedroomsTotal", "BathroomsTotalInteger", "BathroomsFull", "BathroomsHalf",
  "LivingArea", "BuildingAreaTotal",
  "PropertyType", "PropertySubType", "SubdivisionName", "NewConstructionYN",
  "PhotosCount",
  "ListOfficeName", "ListAgentFullName", "ListOfficePhone", "ListAgentMlsId",
  "CoListAgentMlsId", "ModificationTimestamp"
];
const selectFor = (lean) =>
  (lean ? SELECT_CORE : SELECT_CORE.concat("PublicRemarks")).join(",");

function buildClauses(p, agentId) {
  const required = [];
  const optional = [];      // dropped one at a time if the MLS rejects the query

  required.push("(StandardStatus eq 'Active' or StandardStatus eq 'Pending')");

  if (p.scope !== "all" && agentId) {
    required.push(`(ListAgentMlsId eq ${q(agentId)} or CoListAgentMlsId eq ${q(agentId)})`);
  }

  const text = p.q ? textClause(p.q) : null;
  if (text) optional.push(text);

  if (p.type && TYPE_CLAUSE[p.type]) optional.push(TYPE_CLAUSE[p.type]);

  const min = num(p.minPrice), max = num(p.maxPrice);
  if (min) optional.push(`ListPrice ge ${min}`);
  if (max) optional.push(`ListPrice le ${max}`);
  if (p.luxury === "1") optional.push(`ListPrice ge ${LUXURY_FLOOR}`);

  const beds = num(p.beds), baths = num(p.baths);
  if (beds)  optional.push(`BedroomsTotal ge ${beds}`);
  if (baths) optional.push(`BathroomsTotalInteger ge ${baths}`);

  if (p.newConstruction === "1") optional.push("NewConstructionYN eq true");

  return { required, optional };
}

/* GALMLS has a history of 500-ing on filter shapes that look perfectly legal.
   Rather than fail the whole search, try the full query first and then drop
   the optional clauses one at a time. The caller is told which ones survived,
   so the page can say so instead of silently lying about the results. */
function buildAttempts({ required, optional }, { top, skip, orderby, select }) {
  const attempts = [];
  for (let drop = 0; drop <= optional.length; drop++) {
    const kept = optional.slice(0, optional.length - drop);
    const filter = [...required, ...kept].join(" and ");

    /* Deliberately NO $count=true here. Counting matching rows across 12,665
       listings is expensive and the number is only needed for the pager, so it
       is fetched separately and cached — see countFor(). */
    const base = `Property?$filter=${encodeURIComponent(filter)}&$top=${top}` +
                 (skip ? `&$skip=${skip}` : "");
    const sortPart   = orderby ? `&$orderby=${encodeURIComponent(orderby)}` : "";
    const selectPart = select ? `&$select=${encodeURIComponent(select)}` : "";

    /* Try the cheapest shape first: named fields only. If the MLS rejects a
       field name the whole query 500s, so a no-$select fallback follows. Then
       the same again without the sort, since ordering 12,665 rows is the other
       expensive thing GALMLS does. Only after all that do we start giving up
       the visitor's actual search terms. */
    attempts.push({ path: base + selectPart + sortPart, filter, dropped: drop, shape: "select+sort" });
    attempts.push({ path: base + sortPart,              filter, dropped: drop, shape: "sort" });
    attempts.push({ path: base + selectPart,            filter, dropped: drop, shape: "select" });
    attempts.push({ path: base,                         filter, dropped: drop, shape: "bare" });
  }
  return attempts;
}

/* ---------- open houses (separate RESO resource; optional on some servers) ----------
   Asks only about the listings on THIS page. The first version pulled 500
   upcoming open houses on every single request, which was a large part of an
   11.6-second response. A page of 24 needs 24 keys, not the whole calendar. */
async function attachOpenHouses(listings) {
  if (!listings.length) return;
  try {
    const now = new Date().toISOString().split(".")[0] + "Z";
    const keys = listings.slice(0, 60).map(l => l.id);
    const keyClause = "(" + keys.map(k => `ListingKey eq ${q(k)}`).join(" or ") + ")";
    const page = await odata(
      `OpenHouse?$filter=${encodeURIComponent(`OpenHouseStartTime gt ${now} and ${keyClause}`)}` +
      `&$select=ListingKey,OpenHouseStartTime,OpenHouseEndTime&$top=${keys.length * 4}`);
    const byKey = new Map();
    for (const oh of (page.value || [])) {
      const key = String(oh.ListingKey);
      if (byKey.has(key)) continue;                       // keep the soonest only
      const start = new Date(oh.OpenHouseStartTime);
      const end   = oh.OpenHouseEndTime ? new Date(oh.OpenHouseEndTime) : null;
      const t = d => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
      byKey.set(key, {
        date: start.toISOString().slice(0, 10),
        time: end ? `${t(start)}–${t(end)}` : t(start)
      });
    }
    for (const l of listings) if (byKey.has(l.id)) l.openHouse = byKey.get(l.id);
  } catch (err) {
    // Open houses are a nice-to-have. If the resource isn't licensed, carry on.
    console.warn("[idx] open houses unavailable:", err.message);
  }
}

/* The open-houses page is the one view that cannot be expressed as a Property
   filter — "has an upcoming open house" lives in a different resource. So ask
   OpenHouse first, then fetch exactly those listings. */
async function openHouseListings(limit) {
  const now = new Date().toISOString().split(".")[0] + "Z";
  const page = await odata(
    `OpenHouse?$filter=${encodeURIComponent(`OpenHouseStartTime gt ${now}`)}` +
    `&$orderby=OpenHouseStartTime&$top=${Math.min(limit * 3, 300)}`);
  const keys = [];
  for (const oh of (page.value || [])) {
    const k = String(oh.ListingKey || "");
    if (k && !keys.includes(k)) keys.push(k);
    if (keys.length >= limit) break;
  }
  if (!keys.length) return { rows: [], total: 0 };

  const filter = "(" + keys.map(k => `ListingKey eq ${q(k)}`).join(" or ") + ")" +
                 " and (StandardStatus eq 'Active' or StandardStatus eq 'Pending')";
  const res = await odata(`Property?$filter=${encodeURIComponent(filter)}&$count=true&$top=${keys.length}`);
  return { rows: res.value || [], total: res["@odata.count"] ?? (res.value || []).length };
}

/* ---------- how many listings match, cached ----------
   `$count=true` over 12,665 rows is the slowest single thing this endpoint can
   ask the MLS for, and the answer only feeds the pager. So it is fetched with
   its own tiny request, cached per filter for the life of the warm instance,
   and refreshed on a timer. A visitor paging through results pays for it once.
   If the count is unavailable the endpoint still returns listings — the pager
   just falls back to "keep going while there are more pages". */
const _countCache = new Map();          // filter string -> { total, at }
const COUNT_TTL = 15 * 60 * 1000;       // 15 minutes

async function countFor(filter) {
  const hit = _countCache.get(filter);
  if (hit && Date.now() - hit.at < COUNT_TTL) return { total: hit.total, cached: true };
  try {
    const r = await odata(`Property?$filter=${encodeURIComponent(filter)}&$top=1&$count=true`);
    const total = r["@odata.count"] ?? null;
    if (total != null) {
      _countCache.set(filter, { total, at: Date.now() });
      if (_countCache.size > 200) _countCache.delete(_countCache.keys().next().value);
    }
    return { total, cached: false };
  } catch (err) {
    console.warn("[idx] count unavailable:", err.message.slice(0, 120));
    return { total: null, cached: false };
  }
}

/* ---------- probe=speed: WHICH part of a query is slow ----------
   GALMLS response times for the same query have been measured at 6s, 12s, 21s
   and over 45s. This times each factor separately so the cause is measured
   rather than guessed. Run it, then tune the production query. */
async function probeSpeed(res) {
  const base = "(StandardStatus eq 'Active' or StandardStatus eq 'Pending')";
  const f = encodeURIComponent(base);
  const sel = encodeURIComponent(selectFor(true));

  /* Kept deliberately short. An earlier version timed eleven shapes back to
     back and the function itself hit a 504 — each GALMLS query can take 6-20
     seconds, so a probe has to stay under a handful of them. */
  const cases = [
    ["select+sort (production)", `Property?$filter=${f}&$top=24&$select=${sel}&$orderby=ModificationTimestamp%20desc`],
    ["select, no sort",          `Property?$filter=${f}&$top=24&$select=${sel}`],
    ["no select, sort",          `Property?$filter=${f}&$top=24&$orderby=ModificationTimestamp%20desc`],
    ["count only",               `Property?$filter=${f}&$top=1&$count=true`]
  ];

  const out = { ok: true, ranAt: new Date().toISOString(), results: {} };
  await getToken();   // pay the auth cost once, outside the measurements
  for (const [label, path] of cases) {
    const t0 = Date.now();
    try {
      const r = await odata(path);
      out.results[label] = { ms: Date.now() - t0, rows: (r.value || []).length,
                             count: r["@odata.count"] ?? undefined };
    } catch (err) {
      out.results[label] = { ms: Date.now() - t0, error: err.message.slice(0, 110) };
    }
  }
  return res.status(200).json(out);
}

/* ---------- probe: what does this MLS actually accept? ---------- */
async function probe(res) {
  const out = { ok: true, ranAt: new Date().toISOString(), checks: {} };
  const base = "(StandardStatus eq 'Active' or StandardStatus eq 'Pending')";

  const tryClause = async (label, clause) => {
    try {
      const r = await odata(`Property?$filter=${encodeURIComponent(base + (clause ? " and " + clause : ""))}&$count=true&$top=1`);
      out.checks[label] = { ok: true, count: r["@odata.count"] ?? null };
    } catch (err) {
      out.checks[label] = { ok: false, error: err.message.slice(0, 130) };
    }
  };

  await tryClause("baseline", null);
  await tryClause("text-contains", textClause("hoover"));
  await tryClause("price-min", "ListPrice ge 500000");
  await tryClause("price-range", "ListPrice ge 300000 and ListPrice le 900000");
  await tryClause("beds", "BedroomsTotal ge 3");
  await tryClause("baths", "BathroomsTotalInteger ge 2");
  await tryClause("newconstruction", "NewConstructionYN eq true");
  for (const [k, v] of Object.entries(TYPE_CLAUSE)) await tryClause("type:" + k, v);

  // Does deep paging work? $skip is the only way through 12k rows here.
  for (const skip of [0, 200, 5000, 12000]) {
    try {
      const r = await odata(`Property?$filter=${encodeURIComponent(base)}&$top=1&$skip=${skip}`);
      out.checks[`skip-${skip}`] = { ok: true, rows: (r.value || []).length };
    } catch (err) {
      out.checks[`skip-${skip}`] = { ok: false, error: err.message.slice(0, 110) };
    }
  }

  // What page size will it actually give us?
  for (const top of [200, 500, 1000]) {
    try {
      const r = await odata(`Property?$filter=${encodeURIComponent(base)}&$top=${top}`);
      out.checks[`top-${top}`] = { asked: top, got: (r.value || []).length };
    } catch (err) {
      out.checks[`top-${top}`] = { asked: top, error: err.message.slice(0, 110) };
    }
  }

  // The real values in the data, so type filters can be written from fact.
  try {
    const r = await odata(`Property?$filter=${encodeURIComponent(base)}&$top=200`);
    const rows = r.value || [];
    const uniq = (f) => [...new Set(rows.map(x => x[f]).filter(Boolean))].sort();
    out.checks.vocabulary = {
      PropertyType: uniq("PropertyType"),
      PropertySubType: uniq("PropertySubType").slice(0, 30),
      StandardStatus: uniq("StandardStatus")
    };
  } catch (err) {
    out.checks.vocabulary = { error: err.message.slice(0, 130) };
  }

  return res.status(200).json(out);
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  const started = Date.now();
  const p       = req.query || {};
  const scope   = (p.scope || "agent").toString();
  const agentId = process.env.MLS_AGENT_MLS_ID;

  try {
    if (p.probe === "speed") return await probeSpeed(res);
    if (p.probe) return await probe(res);

    /* Michelle has a dozen listings; a market search has 12,620. Only the
       market view needs paging, and only it should be trimmed for size. */
    const isSearch = scope === "all";
    const pageSize = isSearch
      ? Math.min(Math.max(parseInt(p.pageSize, 10) || DEFAULT_PAGE, 1), MAX_PAGE)
      : AGENT_MAX;
    const page = Math.max(parseInt(p.page, 10) || 1, 1);
    const skip = isSearch ? (page - 1) * pageSize : 0;
    const orderby = SORTS[p.sort] || SORTS.newest;

    let rows = [], total = null, usedAttempt = -1, droppedFilters = 0, countCached = null, usedShape = null;
    const attempts = [];
    const t = {};
    const mark = (k, from) => { t[k] = Date.now() - from; };

    if (p.openHouse === "1") {
      const t0 = Date.now();
      const oh = await openHouseListings(pageSize);
      rows = oh.rows; total = oh.total; usedAttempt = 0;
      mark("openHouseQuery", t0);
    } else {
      const clauses = buildClauses({ ...p, scope }, agentId);
      const plan = buildAttempts(clauses, { top: pageSize, skip, orderby, select: selectFor(isSearch) });

      const t0 = Date.now();
      for (let i = 0; i < plan.length; i++) {
        try {
          /* The page of listings and the total count go out together, so the
             visitor waits for the slower of the two rather than the sum. On a
             warm instance the count is already cached and costs nothing. */
          const [r, c] = await Promise.all([
            odata(plan[i].path),
            isSearch ? countFor(plan[i].filter) : Promise.resolve({ total: null, cached: null })
          ]);
          rows = r.value || [];
          total = c.total;
          countCached = c.cached;
          usedAttempt = i;
          usedShape = plan[i].shape;
          droppedFilters = plan[i].dropped;
          break;
        } catch (err) {
          attempts.push(`a${i}: ${err.message.slice(0, 130)}`);
        }
      }
      mark("listingQuery", t0);
      if (usedAttempt === -1) {
        throw new Error("ODATA every filter variant failed :: " + attempts.join(" | "));
      }
    }

    const listings = rows.map(r => normalize(r, { lean: isSearch })).filter(Boolean);
    const t1 = Date.now();
    await attachOpenHouses(listings);
    mark("openHouses", t1);

    /* No count available (cached miss + MLS refused): fall back to "there is
       another page if this one came back full". The pager keeps working, it
       just cannot say "of 12,665". */
    const countKnown = total != null;
    if (!countKnown) total = skip + listings.length + (listings.length === pageSize ? pageSize : 0);
    const hasMore = isSearch ? skip + listings.length < total : false;

    if (p.debug) {
      return res.status(200).json({
        ok: true,
        scope, page, pageSize,
        agentIdConfigured: Boolean(agentId),
        returned: listings.length,
        totalAvailable: total,
        hasMore,
        droppedFilters,
        usedAttempt, usedShape,
        attempts,
        countKnown, countCached,
        timing: t,
        byStatus: listings.reduce((a, l) => ((a[l.status] = (a[l.status] || 0) + 1), a), {}),
        mlsSaysHasPhotos: listings.filter(l => (l.photosCount || 0) > 0).length,
        ms: Date.now() - started
      });
    }

    res.setHeader("Cache-Control",
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`);
    return res.status(200).json({
      listings,
      count: listings.length,
      total,
      page,
      pageSize,
      hasMore,
      countKnown,
      /* If the MLS rejected part of the search, say so. The page tells the
         visitor rather than quietly showing them the wrong results. */
      droppedFilters,
      source: "Greater Alabama MLS",
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error("[idx]", err.message);
    // Never leak the credential or the raw upstream body to the browser.
    const kind = err.message.startsWith("CONFIG") ? 500 : 502;
    return res.status(kind).json({
      listings: [], count: 0, total: 0, hasMore: false,
      error: err.message.split(":")[0] || "UPSTREAM",
      message: "Listing data is temporarily unavailable."
    });
  }
}
