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
const AGENT_MAX       = 200;
const WINDOW_TOP      = 300;       // rows pulled when the MLS cannot narrow a search precisely
const MAX_ATTEMPTS    = 8;         // GALMLS costs 4-6s per try; a long ladder times the function out       // one agent never has more than this
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

/* ---------- what this MLS can actually do (measured, not assumed) ----------
   Sep 13 2026: every text search on this site was returning the whole market.
   Cause: GALMLS answers HTTP 500 to any $filter containing contains(). Numeric
   comparisons and eq are fine — it is the substring function it refuses. The
   old textClause() and TYPE_CLAUSE were built entirely out of contains(), so
   both the search box and the type dropdown failed on every request and the
   retry ladder then dropped them and served the unfiltered market.

   Rather than hard-code "no contains() forever" — Paragon may fix it — this
   measures the server once per warm instance and uses the best tool it has.
   Everything below falls back to eq, which this server has never refused. */
let _caps = null;
const CAPS_TTL = 30 * 60 * 1000;

const CAPS_OFF = { contains: false, startswith: false, at: 0, measured: false };
let _capsInFlight = null;

/* Non-blocking on purpose. eq alone is enough to build every query below, so a
   request never waits on this probe; it learns in the background and the NEXT
   request gets the better operators if the server grew them. */
async function stringCaps() {
  if (_caps && Date.now() < _caps.at + CAPS_TTL) return _caps;
  if (!_capsInFlight) _capsInFlight = measureCaps().finally(() => { _capsInFlight = null; });
  return CAPS_OFF;
}

async function measureCaps() {
  const base = "(StandardStatus eq 'Active' or StandardStatus eq 'Pending')";
  const test = async (clause) => {
    try {
      await odata(`Property?$filter=${encodeURIComponent(base + " and " + clause)}&$top=1`);
      return true;
    } catch { return false; }
  };
  const [contains, startswith] = await Promise.all([
    test("contains(City,'HOOVER')"),
    test("startswith(City,'HOOVER')")
  ]);
  _caps = { contains, startswith, at: Date.now(), measured: true };
  return _caps;
}

/* ---------- the MLS's own vocabulary ----------
   We cannot ask the MLS for "subtype contains Condo", but we can pull a sample
   of what it actually stores and do the substring match HERE, then send back
   exact eq values it will accept. One cheap query, cached for three hours. */
let _vocab = null;
const VOCAB_TTL = 3 * 60 * 60 * 1000;

async function vocabulary() {
  if (_vocab && Date.now() < _vocab.at + VOCAB_TTL) return _vocab;
  const base = "(StandardStatus eq 'Active' or StandardStatus eq 'Pending')";
  let types = [], subs = [];
  try {
    const r = await odata(
      `Property?$filter=${encodeURIComponent(base)}&$top=1000&$select=PropertyType,PropertySubType`);
    const rows = r.value || [];
    types = [...new Set(rows.map(x => x.PropertyType).filter(Boolean))];
    subs  = [...new Set(rows.map(x => x.PropertySubType).filter(Boolean))];
  } catch { /* leave empty — callers fall back to matching rows locally */ }
  _vocab = { types, subs, at: Date.now() };
  return _vocab;
}

/* ---------- property type ----------
   One definition drives both halves: the eq clause sent to the MLS and the
   local check. They can never drift apart. */
const TYPE_MATCH = {
  "lot":           { type: [/land/i, /lot/i],        sub: [/lot/i, /acreage/i, /unimproved/i, /land/i, /farm/i] },
  "commercial":    { type: [/commercial/i, /business/i], sub: [/commercial/i, /office/i, /retail/i, /industrial/i, /warehouse/i, /business/i] },
  "rental":        { type: [/lease/i, /rental/i],    sub: [/rental/i, /lease/i] },
  "condo":         { type: [],                       sub: [/condo/i] },
  /* The dropdown option is labelled "Townhome / Condo", so it must match both.
     It used to match only /town/i and quietly excluded every condominium. */
  "townhome":      { type: [],                       sub: [/town/i, /condo/i] },
  "single-family": { type: [],                       sub: [/single/i, /detached/i, /^residential$/i] }
};

function rowMatchesType(row, key) {
  const m = TYPE_MATCH[key];
  if (!m) return true;
  const pt = String(row.PropertyType || "");
  const ps = String(row.PropertySubType || "");
  if (key === "single-family" && /lease|rental/i.test(pt)) return false;
  return m.type.some(rx => rx.test(pt)) || m.sub.some(rx => rx.test(ps));
}

async function typeClause(key) {
  const m = TYPE_MATCH[key];
  if (!m) return null;
  const v = await vocabulary();
  const hitTypes = v.types.filter(x => m.type.some(rx => rx.test(x)));
  const hitSubs  = v.subs.filter(x => m.sub.some(rx => rx.test(x)));
  const parts = [
    ...hitTypes.map(x => `PropertyType eq ${q(x)}`),
    ...hitSubs.map(x => `PropertySubType eq ${q(x)}`)
  ];
  if (!parts.length) return null;
  let clause = "(" + parts.join(" or ") + ")";
  /* rowMatchesType() excludes leases from single-family. The MLS clause has to
     do the same or the two halves disagree, rows get stripped after paging,
     and the pager numbering jumps. */
  if (key === "single-family") {
    const leases = v.types.filter(x => /lease|rental/i.test(x));
    if (leases.length) {
      clause += " and (" + leases.map(x => `PropertyType ne ${q(x)}`).join(" and ") + ")";
    }
  }
  return clause;
}

/* ---------- reading what the visitor typed ----------
   "4413 Boulder Lake Cir" is a house number plus a street. "35242" is a zip.
   "21463762" is an MLS number. "Liberty Park" is a neighbourhood. Each of
   those wants a different question, and all four can be asked with eq. */
const STREET_SUFFIXES = new Set([
  "ST","STREET","RD","ROAD","DR","DRIVE","LN","LANE","AVE","AVENUE","AV",
  "CIR","CIRCLE","CT","COURT","BLVD","BOULEVARD","WAY","PL","PLACE","PT","POINT",
  "TER","TERRACE","TRL","TRAIL","PKWY","PARKWAY","HWY","HIGHWAY","RUN","LOOP","COVE","CV",
  "N","S","E","W","NE","NW","SE","SW","NORTH","SOUTH","EAST","WEST",
  "UNIT","APT","STE","SUITE","#","AL","ALABAMA"
]);

function parseQuery(raw) {
  const text  = String(raw || "").trim().slice(0, 80);
  const upper = text.toUpperCase().replace(/[^A-Z0-9#\s-]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = upper ? upper.split(" ") : [];
  const out = { text, upper, tokens, mlsNumber: null, zip: null, streetNumber: null,
                numberMayBeZip: false, words: [], needles: [] };
  if (!tokens.length) return out;

  if (tokens.length === 1 && /^\d{6,12}$/.test(tokens[0])) {
    out.mlsNumber = tokens[0]; out.needles = [tokens[0]]; return out;
  }

  let rest = tokens.slice();
  if (/^\d{1,6}[A-Z]?$/.test(rest[0]) && rest.length > 1) {
    out.streetNumber = rest[0].replace(/[^0-9]/g, "");
    /* "35242 Kenmore" is a zip plus a street, but "35242 Old Highway 31" is a
       house number. Five digits is genuinely ambiguous, so ask the MLS about
       both and let the local pass settle it. */
    out.numberMayBeZip = /^\d{5}$/.test(out.streetNumber);
    rest = rest.slice(1);
  }

  /* A five-digit token anywhere is a zip. "35242" on its own, or
     "Vestavia Hills 35242" — both should work. */
  const zipTok = rest.find(w => /^\d{5}$/.test(w));
  if (zipTok) out.zip = zipTok;

  /* Suffix words ("CIR", "DRIVE", "WAY") are dropped from the MLS-side guess
     because spellings vary. They are NOT dropped from the local needles — if
     every word the visitor typed is a suffix word ("cove", "point", "trail"
     are real place names), the search must still mean something. Before
     Sep 13 2026 this filtered twice with the same predicate, so a suffix-only
     query ended up with no needles at all and matched every listing. */
  out.words = rest.filter(w => w.length > 1 && !STREET_SUFFIXES.has(w) && w !== zipTok);
  out.needles = [out.streetNumber, out.zip]
    .concat(out.words.length ? out.words : rest.filter(w => w.length > 1))
    .filter(Boolean);
  if (!out.needles.length) out.needles = tokens.slice();
  return out;
}

/* Every contiguous run of 1-3 words the visitor typed. "BOULDER LAKE VESTAVIA
   HILLS" yields "BOULDER", "BOULDER LAKE", "VESTAVIA HILLS" and so on, so an
   eq-only server can still be asked a question that hits. The local pass then
   ANDs the whole query back together, so a loose OR here cannot leak a wrong
   row into the results. */
function phraseCandidates(words, max = 3, cap = 12) {
  const out = [];
  for (let n = Math.min(max, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(" ");
      if (phrase.length > 1 && !out.includes(phrase)) out.push(phrase);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

function rowText(row) {
  return [row.UnparsedAddress, row.StreetNumber, row.StreetDirPrefix, row.StreetName,
          row.StreetSuffix, row.City, row.StateOrProvince, row.PostalCode,
          row.SubdivisionName, row.ListingId, row.ListingKey]
    .filter(Boolean).join(" ").toUpperCase();
}

/* The MLS-side half of a text search. Built from eq — the one string
   comparison this server has never refused. startswith/contains join in only
   when stringCaps() has measured them working. Returns null when the MLS
   cannot usefully narrow it, and the local pass does the whole job. */
async function textClause(parsed) {
  if (parsed.mlsNumber)
    return `(ListingKey eq ${q(parsed.mlsNumber)} or ListingId eq ${q(parsed.mlsNumber)})`;

  const caps = await stringCaps();
  const like = (field, value) =>
      caps.contains   ? `contains(${field},${q(value)})`
    : caps.startswith ? `startswith(${field},${q(value)})`
    : null;

  /* A house number is exact, indexed, and cuts 12,600 rows to a handful.
     Street SUFFIX spellings vary too much to filter on ("CIR" vs "CIRCLE"),
     so the number narrows and the local pass decides. */
  if (parsed.streetNumber) {
    return parsed.numberMayBeZip
      ? `(StreetNumber eq ${q(parsed.streetNumber)} or PostalCode eq ${q(parsed.streetNumber)})`
      : `StreetNumber eq ${q(parsed.streetNumber)}`;
  }

  /* A zip on its own is exact and cheap.

     KNOWN LIMIT: a row stored as ZIP+4 ("35242-1177") will not match
     PostalCode eq '35242', and eq is the only string comparison this server
     accepts. Measured against the live feed on 2026-09-13: 0 of 288 rows store
     ZIP+4, so this does not occur in GALMLS today. Such a row is still
     reachable by street name or full address. If Paragon ever enables
     startswith(), the like() below fixes it automatically with no code change
     — that is why the probe exists. */
  if (parsed.zip && !parsed.words.length) {
    const z = [`PostalCode eq ${q(parsed.zip)}`, like("PostalCode", parsed.zip)].filter(Boolean);
    return "(" + z.join(" or ") + ")";
  }

  const parts = [];
  if (parsed.zip) parts.push(`PostalCode eq ${q(parsed.zip)}`);

  const cands = phraseCandidates(parsed.words);
  if (cands.length) {
    const alts = [];
    for (const c of cands) {
      alts.push(`City eq ${q(c)}`, `StreetName eq ${q(c)}`, `SubdivisionName eq ${q(c)}`);
      const f = like("UnparsedAddress", c);
      if (f) alts.push(f);
    }
    parts.push("(" + alts.join(" or ") + ")");
  }

  return parts.length ? parts.join(" and ") : null;
}

/* The local half: the MLS narrows, this decides. Every word the visitor typed
   has to appear somewhere in the row. This is what makes "4413 Boulder Lake
   Cir" land on one house instead of every house numbered 4413. */
function rowMatchesText(row, parsed) {
  if (!parsed || !parsed.tokens.length) return true;
  if (parsed.mlsNumber) {
    return String(row.ListingKey || "") === parsed.mlsNumber ||
           String(row.ListingId  || "") === parsed.mlsNumber;
  }
  const hay = rowText(row);
  const needles = parsed.needles || [];
  /* No needles means we could not understand the query at all. Matching
     everything would be the old bug, so match nothing and say so. */
  if (!needles.length) return false;
  return needles.every(n => hay.includes(n));
}

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
/* ---------- turning URL parameters into an MLS query ----------
   Two kinds of optional clause, and the difference is the whole bug fix:

   ESSENTIAL  what the visitor actually asked for — the search text, the type.
              If the MLS will not honour these, the honest answer is "we could
              not search for that", NOT a screen full of unrelated houses.

   DROPPABLE  refinements on top (price, beds, baths, new construction). If the
              MLS rejects one of these the results are broader than asked for,
              which is worth saying out loud but is not a lie.

   Before Sep 13 2026 everything optional was droppable, so a failed search
   quietly became "here is the entire Greater Alabama MLS". */
async function buildClauses(p, agentId) {
  const required  = [];
  const essential = [];
  const droppable = [];
  let parsed = null, localOnlyText = false, localOnlyType = false;

  required.push("(StandardStatus eq 'Active' or StandardStatus eq 'Pending')");

  /* Single-listing lookup for property.html. The MLS does the lookup so that
     Michelle's own listings resolve, not just whatever is on page one. The
     status filter stays (the IDX licence only permits Active and Pending) but
     the agent filter must NOT apply: a visitor can open any brokerage's
     listing from the search results. */
  const wantId = String(p.id || "").trim();
  if (wantId) {
    required.push(`ListingKey eq ${q(wantId)}`);
    return { required, essential, droppable, parsed, localOnlyText, localOnlyType };
  }

  if (p.scope !== "all" && agentId) {
    required.push(`(ListAgentMlsId eq ${q(agentId)} or CoListAgentMlsId eq ${q(agentId)})`);
  }

  if (p.q && String(p.q).trim()) {
    parsed = parseQuery(p.q);
    if (parsed.tokens.length) {
      const clause = await textClause(parsed);
      if (clause) essential.push(clause);
      else localOnlyText = true;   // MLS cannot narrow it; we match every row here
    } else {
      parsed = null;
    }
  }

  if (p.type && TYPE_MATCH[p.type]) {
    const clause = await typeClause(p.type);
    if (clause) essential.push(clause);
    else localOnlyType = true;
  }

  const min = num(p.minPrice), max = num(p.maxPrice);
  if (min) droppable.push(`ListPrice ge ${min}`);
  if (max) droppable.push(`ListPrice le ${max}`);
  /* On luxury.html / new-construction.html this clause IS the page. Dropping
     it would serve the whole market under a "Luxury" heading. */
  if (p.luxury === "1") essential.push(`ListPrice ge ${LUXURY_FLOOR}`);

  const beds = num(p.beds), baths = num(p.baths);
  if (beds)  droppable.push(`BedroomsTotal ge ${beds}`);
  if (baths) droppable.push(`BathroomsTotalInteger ge ${baths}`);

  if (p.newConstruction === "1") essential.push("NewConstructionYN eq true");

  return { required, essential, droppable, parsed, localOnlyText, localOnlyType };
}

/* GALMLS has a history of 500-ing on filter shapes that look perfectly legal,
   so each query is tried in four shapes before any clause is given up, and
   only the DROPPABLE refinements are ever given up. If a shape that still
   carries the visitor's search cannot be served at all, the caller reports
   that plainly instead of widening the search behind their back. */
function buildAttempts({ required, essential, droppable }, { top, skip, orderby, select }) {
  const attempts = [];
  for (let drop = 0; drop <= droppable.length; drop++) {
    const kept   = droppable.slice(0, droppable.length - drop);
    const filter = [...required, ...essential, ...kept].join(" and ");

    /* Deliberately NO $count=true here. Counting matching rows across 12,600
       listings is expensive and the number is only needed for the pager, so it
       is fetched separately and cached — see countFor(). */
    const base = `Property?$filter=${encodeURIComponent(filter)}&$top=${top}` +
                 (skip ? `&$skip=${skip}` : "");
    const sortPart   = orderby ? `&$orderby=${encodeURIComponent(orderby)}` : "";
    const selectPart = select ? `&$select=${encodeURIComponent(select)}` : "";

    /* Cheapest shape first: named fields only. If the MLS rejects a field name
       the whole query 500s, so a no-$select fallback follows, then the same
       again without the sort. */
    attempts.push({ path: base + selectPart + sortPart, filter, dropped: drop, shape: "select+sort" });
    attempts.push({ path: base + sortPart,              filter, dropped: drop, shape: "sort" });
    attempts.push({ path: base + selectPart,            filter, dropped: drop, shape: "select" });
    attempts.push({ path: base,                         filter, dropped: drop, shape: "bare" });
    if (attempts.length >= MAX_ATTEMPTS) return attempts.slice(0, MAX_ATTEMPTS);
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
  await tryClause("text-contains",   "contains(City,'HOOVER')");
  await tryClause("text-startswith", "startswith(City,'HOOVER')");
  await tryClause("text-eq",         "City eq 'HOOVER'");
  await tryClause("streetnumber-eq", "StreetNumber eq '4413'");
  await tryClause("streetname-eq",   "StreetName eq 'BOULDER LAKE'");
  await tryClause("listingkey-eq",   "ListingKey eq '21463762'");
  await tryClause("price-min", "ListPrice ge 500000");
  await tryClause("price-range", "ListPrice ge 300000 and ListPrice le 900000");
  await tryClause("beds", "BedroomsTotal ge 3");
  await tryClause("baths", "BathroomsTotalInteger ge 2");
  await tryClause("newconstruction", "NewConstructionYN eq true");
  for (const k of Object.keys(TYPE_MATCH)) {
    const c = await typeClause(k);
    if (c) await tryClause("type:" + k, c);
    else out.checks["type:" + k] = { ok: false, error: "no matching value in the MLS vocabulary sample" };
  }

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

    /* Michelle has a dozen listings; a market search has 12,600. Only the
       market view needs paging, and only it should be trimmed for size. */
    const isIdLookup = !!String(p.id || "").trim();
    const isSearch = scope === "all" && !isIdLookup;
    const pageSize = isSearch
      ? Math.min(Math.max(parseInt(p.pageSize, 10) || DEFAULT_PAGE, 1), MAX_PAGE)
      : AGENT_MAX;
    const page = Math.max(parseInt(p.page, 10) || 1, 1);
    const orderby = SORTS[p.sort] || SORTS.newest;

    let rows = [], total = null, usedAttempt = -1, droppedFilters = 0,
        countCached = null, usedShape = null, searchUnavailable = false;
    const attempts = [];
    const t = {};
    const mark = (k, from) => { t[k] = Date.now() - from; };

    let clauses = null, windowMode = false, localFiltered = null;
    let usedFilter = null, escalated = false, windowSaturated = false;

    if (p.openHouse === "1") {
      const t0 = Date.now();
      const oh = await openHouseListings(pageSize);
      rows = oh.rows; total = oh.total; usedAttempt = 0;
      mark("openHouseQuery", t0);
    } else {
      const t0 = Date.now();
      clauses = await buildClauses({ ...p, scope }, agentId);

      /* WINDOW MODE. Some searches cannot be narrowed precisely by the MLS —
         a house number matches every street with that number, and a type
         filter falls back to local matching if the vocabulary lookup failed.
         In those cases the row that survives is decided HERE, so paging the
         MLS would page the wrong set: ask for one large window instead, sift
         it, and page within the result. A search that the MLS *can* narrow
         exactly (city, zip, MLS number, subdivision) pages normally. */
      windowMode = isSearch && Boolean(
        clauses.localOnlyText || clauses.localOnlyType ||
        (clauses.parsed && clauses.parsed.streetNumber)
      );

      const top  = windowMode ? WINDOW_TOP : pageSize;
      const skip = windowMode ? 0 : (isSearch ? (page - 1) * pageSize : 0);

      const plan = buildAttempts(clauses, { top, skip, orderby, select: selectFor(isSearch) });

      for (let i = 0; i < plan.length; i++) {
        try {
          /* The page of listings and the total count go out together, so the
             visitor waits for the slower of the two rather than the sum. On a
             warm instance the count is already cached and costs nothing. */
          /* The count used to go out alongside EVERY attempt, including the
             ones that were about to fail — extra load on an MLS that was
             already refusing the query. It now runs once, after a shape has
             actually worked. */
          const r = await odata(plan[i].path);
          rows = r.value || [];
          usedFilter = plan[i].filter;
          usedAttempt = i;
          usedShape = plan[i].shape;
          droppedFilters = plan[i].dropped;
          break;
        } catch (err) {
          attempts.push(`a${i}: ${err.message.slice(0, 130)}`);
        }
      }
      mark("listingQuery", t0);

      /* Every shape failed. Before Sep 13 2026 the retry ladder would have
         kept going with the visitor's search stripped out and served the whole
         market. It no longer does: an unanswerable search returns nothing and
         says so. */
      if (usedAttempt === -1) {
        const askedForSomething =
          (clauses.essential.length > 0) || clauses.localOnlyText || clauses.localOnlyType;
        if (askedForSomething) {
          searchUnavailable = true;
          rows = [];
          total = 0;
        } else {
          throw new Error("ODATA every filter variant failed :: " + attempts.join(" | "));
        }
      }

      /* ZERO-RESULT ESCALATION.
         The precise query is built from eq, which only fires when the visitor's
         words happen to equal a whole field value. "Vestavia Hills 35242" or a
         ZIP+4 row will come back empty even though the listing is there. Rather
         than tell them it does not exist, widen to a window and let the local
         pass decide. Costs one extra round trip, and only when the precise
         query found nothing. */
      if (isSearch && !searchUnavailable && !windowMode && clauses.parsed &&
          rows.length === 0 && usedAttempt !== -1) {
        try {
          const wideFilter = [...clauses.required,
                              ...(p.type && !clauses.localOnlyType
                                    ? clauses.essential.slice(-1) : [])].join(" and ");
          const r2 = await odata(
            `Property?$filter=${encodeURIComponent(wideFilter)}&$top=${WINDOW_TOP}` +
            `&$select=${encodeURIComponent(selectFor(true))}` +
            (orderby ? `&$orderby=${encodeURIComponent(orderby)}` : ""));
          rows = r2.value || [];
          windowMode = true;
          escalated = true;
        } catch (err) {
          attempts.push("escalate: " + err.message.slice(0, 110));
        }
      }

      /* The count. Only meaningful when the MLS did the narrowing; a windowed
         search counts what actually survived instead. */
      if (isSearch && !windowMode && usedFilter) {
        const tc = Date.now();
        const c = await countFor(usedFilter);
        total = c.total; countCached = c.cached;
        mark("count", tc);
      }

      /* The local pass. The MLS narrowed; this decides. It runs ONLY in window
         mode — outside it the MLS clause is already exact, and stripping rows
         after the MLS has paged would make the pager skip listings and
         mis-number the results. */
      if (isSearch && !searchUnavailable && windowMode) {
        const before = rows.length;
        const t1 = Date.now();
        windowSaturated = before >= WINDOW_TOP;
        rows = rows.filter(r =>
          rowMatchesText(r, clauses.parsed) &&
          (!p.type || !TYPE_MATCH[p.type] || rowMatchesType(r, p.type))
        );
        localFiltered = { before, after: rows.length };
        mark("localMatch", t1);
      }

      if (windowMode) {
        const all = rows;
        total = all.length;
        const from = (page - 1) * pageSize;
        rows = all.slice(from, from + pageSize);
        countCached = false;
      }
    }

    const listings = rows.map(r => normalize(r, { lean: isSearch })).filter(Boolean);
    const t1 = Date.now();
    await attachOpenHouses(listings);
    mark("openHouses", t1);

    const skipForPager = windowMode ? (page - 1) * pageSize
                                    : (isSearch ? (page - 1) * pageSize : 0);

    /* No count available (cached miss + MLS refused): fall back to "there is
       another page if this one came back full". The pager keeps working, it
       just cannot say "of 12,600". */
    /* A windowed search knows exactly what it found INSIDE the window. If the
       window came back full there may be more beyond it, so the number stops
       being a true total and the page must not present it as one. */
    const countKnown = (total != null) && !(windowMode && windowSaturated);
    if (!countKnown) total = skipForPager + listings.length + (listings.length === pageSize ? pageSize : 0);
    const hasMore = isSearch ? skipForPager + listings.length < total : false;

    /* What the page needs in order to tell the truth:
         searchUnavailable  the MLS could not answer the search at all
         droppedFilters     extra refinements were given up, results are broader
         windowed           the count is exact but capped at the window        */
    const searchApplied = Boolean(clauses && (clauses.parsed || (p.type && TYPE_MATCH[p.type])));

    if (p.debug) {
      const caps = await stringCaps().catch(() => null);
      const vocab = _vocab ? { types: _vocab.types, subs: _vocab.subs.slice(0, 40) } : null;
      return res.status(200).json({
        ok: true,
        scope, page, pageSize,
        agentIdConfigured: Boolean(agentId),
        returned: listings.length,
        totalAvailable: total,
        hasMore,
        droppedFilters,
        searchUnavailable, searchApplied, windowed: windowMode,
        escalated, windowSaturated, usedFilter,
        parsed: clauses ? clauses.parsed : null,
        essentialClauses: clauses ? clauses.essential : null,
        localOnly: clauses ? { text: clauses.localOnlyText, type: clauses.localOnlyType } : null,
        localFiltered,
        mlsStringSupport: caps ? { contains: caps.contains, startswith: caps.startswith } : null,
        vocabulary: vocab,
        usedAttempt, usedShape,
        attempts,
        countKnown, countCached,
        timing: t,
        byStatus: listings.reduce((a, l) => ((a[l.status] = (a[l.status] || 0) + 1), a), {}),
        mlsSaysHasPhotos: listings.filter(l => (l.photosCount || 0) > 0).length,
        ms: Date.now() - started
      });
    }

    /* A failed search must not be cached like a good answer. */
    res.setHeader("Cache-Control", searchUnavailable
      ? "public, max-age=0, must-revalidate"
      : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`);

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
      searchUnavailable,
      searchApplied,
      windowed: windowMode,
      truncated: Boolean(windowMode && windowSaturated),
      windowLimit: windowMode ? WINDOW_TOP : null,
      query: clauses && clauses.parsed ? clauses.parsed.text : null,
      source: "Greater Alabama MLS",
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error("[idx]", err.message);
    // Never leak the credential or the raw upstream body to the browser.
    const kind = err.message.startsWith("CONFIG") ? 500 : 502;
    /* searchUnavailable, not an empty result. Without this the page tells the
       visitor their property does not exist whenever the MLS has a bad minute. */
    return res.status(kind).json({
      listings: [], count: 0, total: 0, hasMore: false,
      searchUnavailable: true,
      error: err.message.split(":")[0] || "UPSTREAM",
      message: "Listing data is temporarily unavailable."
    });
  }
}
