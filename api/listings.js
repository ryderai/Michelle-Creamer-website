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
/* Four shapes per drop level. The cap has to leave room for every droppable
   clause to actually be dropped — a fixed 8 meant a query with three
   refinements could never reach the bottom of its own ladder and 502'd
   instead. */
const SHAPES_PER_LEVEL = 4;
const MAX_LEVELS       = 4;       // one agent never has more than this
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
/* Vercel hands back an array when a parameter repeats: ?beds=1&beds=2 arrives
   as ["1","2"], and String() turned that into "1,2" -> 12. A visitor got
   "12+ bedrooms" and no results. Take the first value and ignore the rest. */
const one = (v) => Array.isArray(v) ? v[0] : v;
const num = (v) => {
  const n = Number(String(one(v)).replace(/[^0-9.]/g, ""));
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
const CAPS_TTL = 30 * 60 * 1000;

const CAPS_OFF = { contains: false, startswith: false, at: 0, measured: false };

/* ONE probe answers both questions at once: which fields this server will
   filter on, and which string operator it accepts. It is AWAITED, not fired in
   the background — an earlier version returned a safe subset while the probe
   ran, which meant the first request after a cold start searched only City and
   PostalCode and found nothing. Being two seconds slower once per warm instance
   beats being wrong. Cached for 30 minutes after that. */
const TEXT_FIELDS_SAFE    = ["City", "PostalCode"];               // measured working
const TEXT_FIELDS_DOUBTED = ["StreetName", "SubdivisionName", "UnparsedAddress"];
const PROBE_MISS = "ZQXJVWQ";      // matches nothing, so the probe stays cheap

let _probe = null, _probeInFlight = null;
const PROBE_TTL = 30 * 60 * 1000;
/* If the probe came back degraded, re-ask sooner — a transient MLS blip should
   not lock the site into a worse search for half an hour. */
const DEGRADED_TTL = 5 * 60 * 1000;

async function runProbe() {
  const base = "(StandardStatus eq 'Active' or StandardStatus eq 'Pending')";
  const ask = async (clause) => {
    try {
      await odata(`Property?$filter=${encodeURIComponent(base + " and " + clause)}&$top=1`);
      return true;
    } catch { return false; }
  };

  /* PER FIELD, PER OPERATOR. Measured 2026-09-14: this server does not have one
     answer for "does contains() work". `contains(City,...)` is accepted while
     `City eq '...'` is refused, and StreetName behaves the other way round.
     An earlier version settled the operator with a single query against City
     and applied that answer to every field — so one field's quirk decided how
     the whole site searched, and picking `eq` meant a search for "boulder"
     could never match the street "BOULDER LAKE".

     Each field now carries its own operator. Two parallel waves, cached. */
  const all = TEXT_FIELDS_SAFE.concat(TEXT_FIELDS_DOUBTED);

  const withContains = await Promise.all(all.map(f => ask(`contains(${f},'${PROBE_MISS}')`)));
  const stillUnknown = all.filter((f, i) => !withContains[i]);
  const withEq = await Promise.all(stillUnknown.map(f => ask(`${f} eq '${PROBE_MISS}'`)));

  const ops = {};
  all.forEach((f, i) => { if (withContains[i]) ops[f] = "contains"; });
  stillUnknown.forEach((f, i) => { if (withEq[i]) ops[f] = "eq"; });

  const usable   = all.filter(f => ops[f]);
  const rejected = all.filter(f => !ops[f]);

  /* A field that only does eq can still be searched, it just needs the whole
     value. A field that does contains is far more useful, so those sort first
     in the fan-out. */
  _probe = {
    ops,
    usable,
    rejected,
    /* Kept for the zip and house-number clauses, which ask about one field. */
    contains: ops.PostalCode === "contains",
    startswith: false,
    /* Degraded results should not be trusted for long. */
    at: Date.now(),
    ttl: rejected.length > 1 ? DEGRADED_TTL : PROBE_TTL,
    measured: true
  };
  return _probe;
}

async function searchCaps() {
  if (_probe && Date.now() < _probe.at + (_probe.ttl || PROBE_TTL)) return _probe;
  if (!_probeInFlight) _probeInFlight = runProbe().finally(() => { _probeInFlight = null; });
  return _probeInFlight;
}

/* Kept for the callers that only care about the operator. */
async function stringCaps() {
  const p = await searchCaps();
  return { contains: p.contains, startswith: p.startswith, at: p.at, measured: true };
}

async function textFields() {
  const p = await searchCaps();
  return p.usable;
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
/* Words that are never a search on their own: compass points, the state, unit
   markers. "AL" matches StateOrProvince on every listing in the feed, so
   letting it stand as a search term is a whole-market dump in disguise. */
const NOISE_WORDS = new Set([
  "N","S","E","W","NE","NW","SE","SW","NORTH","SOUTH","EAST","WEST",
  "UNIT","APT","STE","SUITE","#","AL","ALABAMA","USA","US"
]);

/* Street-type words. Dropped when guessing a street name, because "CIR" and
   "CIRCLE" are the same street — but KEPT as searchable words, because "Cove",
   "Point" and "Trail" are real Alabama place names somebody will type. */
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

  /* A lone number is a house number worth asking about — "4413" used to fall
     through to a word search and never reach StreetNumber at all. */
  if (tokens.length === 1 && /^\d{1,6}[A-Z]?$/.test(tokens[0])) {
    out.streetNumber = tokens[0].replace(/[^0-9]/g, "");
    out.numberMayBeZip = /^\d{5}$/.test(out.streetNumber);
    /* Five digits alone is far more often a zip than a house number, but it can
       be either, so it stays both and the MLS is asked about both. */
    if (out.numberMayBeZip) out.zip = out.streetNumber;
    out.needles = [out.streetNumber];
    return out;
  }

  let rest = tokens.slice();
  if (/^\d{1,6}[A-Z]?$/.test(rest[0]) && rest.length > 1) {
    out.streetNumber = rest[0].replace(/[^0-9]/g, "");
    /* "35242 Kenmore" is a zip plus a street, but "35242 Old Highway 31" is a
       house number. Five digits is genuinely ambiguous, so it is recorded as
       BOTH and the MLS is asked about both. Recording only streetNumber meant
       a leading zip was never searched as a zip at all. */
    out.numberMayBeZip = /^\d{5}$/.test(out.streetNumber);
    if (out.numberMayBeZip) out.zip = out.streetNumber;
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
  out.words = rest.filter(w =>
    w.length > 1 && !STREET_SUFFIXES.has(w) && !NOISE_WORDS.has(w) && w !== zipTok);
  /* The fallback must not re-admit the noise words, and must not admit
     single letters: needles of ["A","B"] match nearly every listing, which is
     the whole-market dump wearing a disguise. */
  const fallback = rest.filter(w => w.length > 1 && !NOISE_WORDS.has(w));
  out.needles = [out.streetNumber, out.zip]
    .concat(out.words.length ? out.words : fallback)
    .filter(Boolean);
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
  /* Proven fields only — these two never 500 and settle the two most common
     searches outright. */
  if (parsed.mlsNumber)
    return `(ListingKey eq ${q(parsed.mlsNumber)} or ListingId eq ${q(parsed.mlsNumber)})`;

  const probe = await searchCaps();
  const ops   = probe.ops || {};
  const caps  = { contains: ops.PostalCode === "contains", startswith: false };
  const match = (field, value) =>
    ops[field] === "contains" ? `contains(${field},${q(value)})` : `${field} eq ${q(value)}`;

  /* A house number is exact, indexed, and cuts 12,600 rows to a handful.
     Street SUFFIX spellings vary too much to filter on ("CIR" vs "CIRCLE"),
     so the number narrows and the local pass decides. */
  if (parsed.streetNumber) {
    if (!parsed.numberMayBeZip) return `StreetNumber eq ${q(parsed.streetNumber)}`;
    const alts = [`StreetNumber eq ${q(parsed.streetNumber)}`,
                  `PostalCode eq ${q(parsed.streetNumber)}`];
    /* One contains() in a filter is accepted by this server; several are not.
       This is the one. */
    if (caps.contains || caps.startswith) alts.push(match("PostalCode", parsed.streetNumber));
    return "(" + alts.join(" or ") + ")";
  }

  /* A zip on its own is exact and cheap.

     KNOWN LIMIT: with eq alone a ZIP+4 row ("35242-1177") would not match
     PostalCode eq '35242'. Measured on the live feed 2026-09-13: 0 of 288 rows
     store ZIP+4. Where the server accepts contains() — it does today — the
     match() below covers it anyway. */
  if (parsed.zip && !parsed.words.length) {
    const z = [`PostalCode eq ${q(parsed.zip)}`];
    if (caps.contains || caps.startswith) z.push(match("PostalCode", parsed.zip));
    return "(" + z.join(" or ") + ")";
  }

  /* A multi-word search is NOT built here. It goes to textSearchRows(), which
     asks one field at a time. An earlier version assembled up to 48 contains()
     into a single filter — the exact shape this server answers 500 to. That
     code is gone rather than left dormant, because one edit to the routing
     above would have re-armed it. */

  /* Nothing the server will accept for this shape. Return null so the caller
     switches to a window and decides locally, rather than sending a query that
     500s. */
  return null;
}

/* ---------- text search: fan out, don't pile up ----------
   Measured on the live feed 2026-09-14, after two wrong theories:

     contains(City,'HOOVER')                              -> 200 OK
     (PostalCode eq '35242' or contains(PostalCode,'…'))  -> 200 OK, 8.8s, rows
     (contains(City,…) or contains(SubdivisionName,…)
      or contains(StreetName,…))                          -> 500 in 767ms

   ONE contains() is fine. THREE of them OR'd together are refused outright —
   in well under a second, so this is the server rejecting the shape of the
   query, not timing out on the work. Field count is not the issue either: a
   four-way OR of eq clauses across PropertyType and PropertySubType works.

   So the text search stops trying to say everything in one filter. It asks one
   small, proven question per field, in PARALLEL, and merges the answers. Total
   wait is the slowest single query rather than the sum, and every query sent is
   a shape this server has already answered.

   `UnparsedAddress` is excluded by the field probe — naming it 500s a query on
   its own, whatever the operator. */

/* Order matters: a person searching words is usually naming a street, a
   neighbourhood or a town, in that order. PostalCode is last and only ever
   asked about digits. */
const FANOUT_FIELD_ORDER = ["StreetName", "SubdivisionName", "City", "UnparsedAddress", "PostalCode"];
const FANOUT_FIELDS_MAX = 4;
const TERMS_MAX = 3;          // worst case 3 terms x 4 fields, breaking on the first hit
const FANOUT_DEADLINE_MS = 15000;   // stop asking rather than risk the 60s function ceiling

async function textSearchRows(parsed, { required, extra = [], top, orderby, select, keep }) {
  const startedAt = Date.now();
  const caps   = await stringCaps();
  const probe  = await searchCaps();
  const usable = probe.usable;
  const ops    = probe.ops || {};
  /* Preferred order, but a field that can do contains() earns its place ahead
     of one that can only match a whole value. */
  const fields = FANOUT_FIELD_ORDER
    .filter(f => usable.includes(f))
    .sort((a, b) => (ops[b] === "contains" ? 1 : 0) - (ops[a] === "contains" ? 1 : 0))
    .slice(0, FANOUT_FIELDS_MAX);
  /* "Incomplete" means we could not search where a street or neighbourhood name
     lives AT ALL. UnparsedAddress is permanently rejected by this server, so
     counting it made this flag constantly true and therefore meaningless —
     every genuine miss was being reported as "we could not look everywhere". */
  const incomplete = !usable.includes("StreetName") && !usable.includes("SubdivisionName");
  const match = (f, v) => ops[f] === "contains" ? `contains(${f},${q(v)})` : `${f} eq ${q(v)}`;
  const anyContains = fields.some(f => ops[f] === "contains");

  /* Everything the visitor asked for that this server can filter on travels
     with every fan-out query — price, beds, baths, type, luxury. Leaving them
     out was how a word search silently widened to the whole city. */
  const base = required.concat(extra);
  const run = async (clause) => {
    const filter = base.concat([clause]).join(" and ");
    const path = `Property?$filter=${encodeURIComponent(filter)}&$top=${top}` +
                 (select  ? `&$select=${encodeURIComponent(select)}`   : "") +
                 (orderby ? `&$orderby=${encodeURIComponent(orderby)}` : "");
    const r = await odata(path);
    return r.value || [];
  };

  /* What to ask about depends on the operator, and getting this backwards
     costs real results.

     With contains(), the BROADEST ask is the best one: "BOULDER" matches the
     street "BOULDER LAKE" and the MLS returns a handful of rows, which the
     local pass then narrows to exactly what was typed. Recall from the server,
     precision here.

     With eq, the opposite: only a whole field value can match, so the longest
     phrase goes first and shorter runs follow. "BOULDER LAKE VESTAVIA HILLS"
     equals no field, but "BOULDER LAKE" equals a StreetName. */
  const askWords = parsed.words.length ? parsed.words : parsed.needles;
  const phrase = askWords.join(" ");
  const byLength = askWords.slice().sort((a, b) => b.length - a.length);
  /* With contains() available, the broadest ask is best: "BOULDER" matches the
     street "BOULDER LAKE" and the local pass narrows it. With eq only, the
     longest phrase has to go first because a whole field value must match. */
  const terms = anyContains
    ? [byLength[0], phrase, ...byLength.slice(1)]
    : phraseCandidates(askWords, 3, 6);
  const wanted = [...new Set(terms.filter(Boolean))];
  const uniqueTerms = wanted.slice(0, TERMS_MAX);
  let termsTruncated = wanted.length > uniqueTerms.length;
  let hitDeadline = false;

  /* The probe found no field this server will filter on — during an outage,
     every probe query fails and `usable` comes back empty. We cannot search at
     all, and saying "no listings match" would be a lie. */
  if (!fields.length) {
    return { rows: [], saturated: false, notes: ["no searchable field available"],
             incomplete: true, allFailed: true, exhaustedTerms: false };
  }

  const seen = new Map();
  const notes = [];
  let saturated = false, issued = 0, failedQueries = 0;

  for (const term of uniqueTerms) {
    if (!term) continue;

    /* The reliable path: one small question per field, all at once. Every
       usable field is asked — truncating this list is how a search for
       "Liberty Park" missed the subdivision it was named after. */
    const picked = fields.filter(f => f !== "PostalCode" || /^\d+$/.test(term));
    const settled = await Promise.allSettled(picked.map(f => run(match(f, term))));
    settled.forEach((res, i) => {
      issued++;
      if (res.status === "fulfilled") {
        res.value.forEach(r => seen.set(r.ListingKey, r));
        if (res.value.length >= top) saturated = true;
        notes.push(`${picked[i]}:${term}:${res.value.length}`);
      } else {
        failedQueries++;
        notes.push(`${picked[i]}:${term}:FAILED`);
      }
    });
    /* Only stop once a term has produced a row that actually SURVIVES the
       local AND-pass. "liberty park hoover" hits on "LIBERTY" via
       SubdivisionName, but no single row carries both the subdivision and that
       city — stopping there reported a confident "no match" for a query we had
       barely begun. */
    if (keep ? [...seen.values()].some(keep) : seen.size) break;
    /* Stop early rather than risk the function's 60s ceiling. */
    if (Date.now() - startedAt > FANOUT_DEADLINE_MS) { notes.push("deadline"); hitDeadline = true; break; }
  }

  /* Every query we sent failed: that is an outage, not an empty result. Before
     this, a total MLS failure rendered as a clean "no listings match". */
  const allFailed = issued > 0 && failedQueries === issued;
  /* Only true when we STOPPED EARLY — the deadline fired, or there were more
     phrasings to try than we were willing to ask about. Having asked
     everything and found nothing is a real miss, and saying otherwise made
     this flag constant and therefore worthless. */
  const exhaustedTerms = !allFailed && (hitDeadline || termsTruncated);
  return { rows: [...seen.values()], saturated, notes, incomplete, allFailed, exhaustedTerms };
}

/* ---------- the local pass checks EVERYTHING the visitor asked for ----------
   Not just the words. A review on 2026-09-14 found that a word search threw
   away price, bedroom and bathroom filters entirely: they lived in `droppable`,
   the fan-out never sent them, and nothing re-checked them here. A visitor
   asking for 5-bed homes over $800k in Hoover got every Hoover listing at every
   price, with no notice. That is the original bug in miniature, so every
   predicate now has a local twin and they are applied together. */
function rowMatchesAll(row, p, parsed) {
  if (!rowMatchesText(row, parsed)) return false;
  if (p.type && TYPE_MATCH[p.type] && !rowMatchesType(row, p.type)) return false;

  const price = Number(row.ListPrice);
  const min = num(p.minPrice), max = num(p.maxPrice);
  if (min && !(price >= min)) return false;
  if (max && !(price <= max)) return false;
  if (p.luxury === "1" && !(price >= LUXURY_FLOOR)) return false;

  const beds = num(p.beds), baths = num(p.baths);
  if (beds  && !(Number(row.BedroomsTotal) >= beds)) return false;
  if (baths) {
    /* Mirror mapBaths(): a card showing "3 baths" from BathroomsFull/Half must
       not be thrown out because BathroomsTotalInteger happens to be null. */
    const shown = mapBaths(row);
    if (!(Number(shown) >= baths)) return false;
  }

  if (p.newConstruction === "1" && row.NewConstructionYN !== true) return false;
  return true;
}

/* Sorting has to be redone locally whenever rows came from more than one query:
   merging three separately-sorted lists does not give one sorted list. */
function sortRows(rows, orderby) {
  if (!orderby) return rows;
  const [field, dir] = String(orderby).split(" ");
  const sign = dir === "desc" ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = a[field], y = b[field];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x === y ? 0 : (x > y ? sign : -sign);
  });
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
  let parsed = null, localOnlyText = false, localOnlyType = false, fanoutText = false;
  let textClauseUsed = null, unreadableQuery = false;

  required.push("(StandardStatus eq 'Active' or StandardStatus eq 'Pending')");

  /* Single-listing lookup for property.html. The MLS does the lookup so that
     Michelle's own listings resolve, not just whatever is on page one. The
     status filter stays (the IDX licence only permits Active and Pending) but
     the agent filter must NOT apply: a visitor can open any brokerage's
     listing from the search results. */
  const wantId = String(p.id || "").trim();
  if (wantId) {
    required.push(`ListingKey eq ${q(wantId)}`);
    return { required, essential, droppable, parsed, localOnlyText, localOnlyType, fanoutText, textClauseUsed, unreadableQuery };
  }

  if (p.scope !== "all" && agentId) {
    required.push(`(ListAgentMlsId eq ${q(agentId)} or CoListAgentMlsId eq ${q(agentId)})`);
  }

  if (one(p.q) && String(one(p.q)).trim()) {
    parsed = parseQuery(one(p.q));
    /* Something was typed but nothing searchable came out of it — "!!!", a
       non-Latin script, single letters. Falling through here meant no clause
       was built and the endpoint answered with page one of the entire MLS.
       That is the original bug, so it now returns nothing and says why. */
    if (!parsed.needles.length) {
      unreadableQuery = true;
      parsed = null;
    } else if (parsed.tokens.length) {
      /* A word search is run by textSearchRows() as several small parallel
         queries, because this server refuses a filter with more than one
         contains() in it. Everything else — MLS number, zip, house number —
         is a single proven clause and goes through the normal path. */
      /* needles, not words: "cove" and "point" are street-type words that carry
         no weight when guessing a street name, but they are perfectly good
         things to search for and must still reach the fan-out. */
      const searchable = parsed.words.length ||
        (parsed.needles.length && !parsed.streetNumber && !parsed.zip);
      if (searchable && !parsed.mlsNumber && !parsed.streetNumber) {
        fanoutText = true;
      } else {
        const clause = await textClause(parsed);
        if (clause) { essential.push(clause); textClauseUsed = clause; }
        else localOnlyText = true;
      }
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
  /* Some rows leave BathroomsTotalInteger null and carry the count in
     BathroomsFull instead — mapBaths() already falls back to it for display, so
     the filter has to as well, or a card showing "3 baths" gets excluded by a
     2-bath search. */
  if (baths) droppable.push(
    `(BathroomsTotalInteger ge ${baths} or BathroomsFull ge ${baths})`);

  if (p.newConstruction === "1") essential.push("NewConstructionYN eq true");

  return { required, essential, droppable, parsed, localOnlyText, localOnlyType, fanoutText, textClauseUsed, unreadableQuery };
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
    if (drop >= MAX_LEVELS && drop < droppable.length) continue;
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
    let usedFilter = null, escalated = false, windowSaturated = false, searchLimited = false;
    let fanoutNotes = null;

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
      /* A bare five-digit zip is an exact PostalCode clause and pages through
         the MLS normally. Forcing it into a 300-row window capped the most
         common IDX search on the site at the 300 newest listings. Only a house
         number WITH a street name needs the window, because there the street
         is decided locally. */
      const zipOnly = clauses.parsed && clauses.parsed.numberMayBeZip &&
                      !clauses.parsed.words.length;
      windowMode = isSearch && !clauses.unreadableQuery && Boolean(
        clauses.localOnlyText || clauses.localOnlyType || clauses.fanoutText ||
        (clauses.parsed && clauses.parsed.streetNumber && !zipOnly)
      );

      const top  = windowMode ? WINDOW_TOP : pageSize;
      const skip = windowMode ? 0 : (isSearch ? (page - 1) * pageSize : 0);

      if (clauses.unreadableQuery) {
        rows = []; total = 0; usedAttempt = 0; usedShape = "unreadable";
        searchLimited = true;
        mark("listingQuery", t0);
      } else if (clauses.fanoutText) {
        /* Several small parallel queries, merged. One filter naming every field
           is refused by this server; one field at a time is not. */
        /* Previously this passed essential[last] and called it "the type
           clause". It was whatever happened to be last — so `?q=hoover&luxury=1`
           sent the luxury clause as the type, and `&luxury=1&newConstruction=1`
           dropped luxury on the floor. All of them travel now. */
        try {
          /* Try with every refinement, then without the droppable ones. In the
             fan-out these used to travel with no ladder at all, so a single
             clause the MLS disliked turned "show me Hoover under $400k" into a
             hard outage instead of broader results. */
          let out = await textSearchRows(clauses.parsed, {
            required: clauses.required,
            extra: clauses.essential.concat(clauses.droppable),
            top, orderby, select: selectFor(isSearch),
            keep: (r) => rowMatchesAll(r, p, clauses.parsed)
          });
          if (out.allFailed && clauses.droppable.length) {
            out = await textSearchRows(clauses.parsed, {
              required: clauses.required,
              extra: clauses.essential,
              top, orderby, select: selectFor(isSearch),
              keep: (r) => rowMatchesAll(r, p, clauses.parsed)
            });
            if (!out.allFailed) droppedFilters = clauses.droppable.length;
          }
          rows = out.rows;
          fanoutNotes = out.notes;
          windowSaturated = out.saturated;
          if (out.allFailed) {
            searchUnavailable = true;
            rows = [];
          } else if (!rows.length && (out.incomplete || out.exhaustedTerms)) {
            searchLimited = true;
          }
          usedAttempt = 0;
          usedShape = "fanout";
        } catch (err) {
          attempts.push("fanout: " + err.message.slice(0, 120));
        }
        mark("listingQuery", t0);
      } else {

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
      }

      /* A fan-out that could not run at all is an outage, not an empty result. */
      if (clauses.fanoutText && usedAttempt === -1) {
        searchUnavailable = true;
        rows = [];
        total = 0;
      }

      /* ZERO-RESULT ESCALATION.
         The precise query is built from eq, which only fires when the visitor's
         words happen to equal a whole field value. "Vestavia Hills 35242" or a
         ZIP+4 row will come back empty even though the listing is there. Rather
         than tell them it does not exist, widen to a window and let the local
         pass decide. Costs one extra round trip, and only when the precise
         query found nothing. */
      if (isSearch && !searchUnavailable && !windowMode && !clauses.fanoutText &&
          clauses.parsed && rows.length === 0 && usedAttempt !== -1) {
        try {
          /* Carry everything except the text clause, which is the part that
             found nothing. Dropping price here is how "$5M homes in 35242"
             came back full of $300k houses. */
          const keep = clauses.essential.filter(c => c !== clauses.textClauseUsed)
                                        .concat(clauses.droppable);
          const wideFilter = [...clauses.required, ...keep].join(" and ");
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
      /* Runs whenever rows came back looser than what was typed — including on
         agent scope, which used to skip this entirely and return "any listing
         matching any one word on any field". */
      if (!searchUnavailable && clauses && (windowMode || clauses.fanoutText) &&
          (clauses.parsed || clauses.localOnlyType)) {
        const before = rows.length;
        const t1 = Date.now();
        if (!windowSaturated) windowSaturated = before >= WINDOW_TOP;
        rows = rows.filter(r => rowMatchesAll(r, p, clauses.parsed));
        /* Merging several per-field queries destroys the server's ordering, so
           the sort is redone here before anything is paged. */
        rows = sortRows(rows, orderby);
        localFiltered = { before, after: rows.length };
        mark("localMatch", t1);
      }

      /* When the MLS would not narrow the search at all, we only sifted the
         most recent WINDOW_TOP listings. Finding nothing there is not proof the
         property is absent, and must not be reported as "no match" — that is
         the mistake that made a live listing look deleted. */
      /* Only a window drawn from the WHOLE market is untrustworthy. A
         house-number search is different: `StreetNumber eq '4413'` returns
         every 4413 in Alabama, so finding no Boulder Lake among them really is
         proof, and that case must still say a plain "no match". */
      if (!searchUnavailable && windowMode && rows.length === 0 && clauses &&
          (clauses.localOnlyText || escalated)) {
        searchLimited = true;
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
    /* Only invent a number when there genuinely is none. A windowed search has
       counted exactly what it found; overwriting that with
       skip + returned + pageSize showed "72 properties" for a city with
       thousands. countKnown stays false so the page says "or more". */
    if (total == null) {
      total = skipForPager + listings.length + (listings.length === pageSize ? pageSize : 0);
    }
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
        escalated, windowSaturated, searchLimited, usedFilter, fanoutNotes,
        parsed: clauses ? clauses.parsed : null,
        essentialClauses: clauses ? clauses.essential : null,
        localOnly: clauses ? { text: clauses.localOnlyText, type: clauses.localOnlyType } : null,
        localFiltered,
        mlsStringSupport: caps ? { contains: caps.contains, startswith: caps.startswith } : null,
        mlsFilterableFields: _probe ? { perField: _probe.ops, rejected: _probe.rejected } : 'probing',
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
    /* A degraded answer must not outlive the outage that caused it. Caching a
       searchLimited empty result for three hours kept a bad answer alive long
       after the MLS recovered. */
    res.setHeader("Cache-Control", (searchUnavailable || searchLimited)
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
      searchLimited,
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
