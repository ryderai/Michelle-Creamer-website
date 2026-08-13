/* ============================================================
   Michelle Creamer — IDX feed proxy  (Vercel serverless function)
   ------------------------------------------------------------
   WHY THIS FILE EXISTS
   The website cannot call the MLS directly from the browser. The
   OAuth credential is a *confidential* client secret — putting it
   in front-end JS would publish AI Syndicate's MLS access to
   anyone who views source. IDX license terms also prohibit
   re-serving the raw feed publicly.

   So: this function holds the secret server-side, talks to
   Paragon, normalizes the records into the exact shape
   js/listings.js already renders, and returns clean JSON.

   ENVIRONMENT VARIABLES (set in Vercel → Settings → Environment
   Variables. Never commit these.)
     MLS_CLIENT_ID       e.g. AISCidx
     MLS_CLIENT_SECRET   the vendor password
     MLS_AGENT_MLS_ID    Michelle's agent ID (optional — see below)

   ENDPOINT
     GET /api/listings              → Michelle's listings (if agent id set)
     GET /api/listings?scope=all    → all active market listings
     GET /api/listings?debug=1      → counts + timing, no listing data
   ============================================================ */

const TOKEN_URL    = "https://galmls.paragonrels.com/OData/GALMLS/identity/connect/token";
const SERVICE_ROOT = "https://galmls.paragonrels.com/OData/GALMLS/DD1.7";

const LUXURY_FLOOR   = 1000000;  // price at/above this gets the "Luxury" chip
const PAGE_SIZE      = 200;      // records per request
const MAX_RECORDS    = 1000;     // hard stop so a bad filter can't run away
const CACHE_SECONDS  = 60 * 60 * 3;   // 3h — well inside the 12h IDX refresh floor

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
let _token = null;        // { value, expiresAt }

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

  if (!res.ok) {
    // Deliberately does not echo the response body — it can contain the credential.
    throw new Error(`AUTH: token request failed (${res.status})`);
  }

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
    throw new Error(`ODATA ${res.status} on ${path.split("?")[0]}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/* Follow @odata.nextLink until we run out or hit MAX_RECORDS. */
async function odataAll(path) {
  const out = [];
  let page = await odata(path);
  out.push(...(page.value || []));

  while (page["@odata.nextLink"] && out.length < MAX_RECORDS) {
    const next = page["@odata.nextLink"].replace(SERVICE_ROOT + "/", "");
    page = await odata(next);
    out.push(...(page.value || []));
  }
  return out.slice(0, MAX_RECORDS);
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

function mapPhotos(raw) {
  const media = Array.isArray(raw.Media) ? raw.Media : [];
  return media
    .filter(m => m && m.MediaURL && (!m.MediaCategory || /photo|image/i.test(m.MediaCategory)))
    .sort((a, b) => (a.Order ?? a.MediaKey ?? 0) - (b.Order ?? b.MediaKey ?? 0))
    .map(m => m.MediaURL);
}

function normalize(raw) {
  const status = STATUS_MAP[raw.StandardStatus];
  if (!status) return null;                       // drop anything not displayable

  const photos = mapPhotos(raw);
  const price  = raw.StandardStatus === "Closed"
    ? (raw.ClosePrice ?? raw.ListPrice)
    : raw.ListPrice;

  return {
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

    photo:       photos[0] || "img/hero-vestlake-home.jpg",
    photos,
    blurb:       "",
    description: raw.PublicRemarks || "",
    details:     null,

    /* IDX attribution — REQUIRED on display for every listing that
       is not Michelle's own. See NAR IDX Policy 7.58. */
    listOffice:      raw.ListOfficeName   || "",
    listAgent:       raw.ListAgentFullName|| "",
    listOfficePhone: raw.ListOfficePhone  || "",
    listAgentMlsId:  raw.ListAgentMlsId   || "",

    modified: raw.ModificationTimestamp || null
  };
}

/* ---------- open houses (separate RESO resource; optional on some servers) ---------- */
async function attachOpenHouses(listings) {
  try {
    const now = new Date().toISOString().split(".")[0] + "Z";
    const rows = await odataAll(
      `OpenHouse?$filter=OpenHouseStartTime gt ${now}` +
      `&$select=ListingKey,OpenHouseStartTime,OpenHouseEndTime&$top=${PAGE_SIZE}`
    );
    const byKey = new Map();
    for (const oh of rows) {
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

/* ---------- handler ---------- */
export default async function handler(req, res) {
  const started = Date.now();
  const scope   = (req.query.scope || "agent").toString();
  const agentId = process.env.MLS_AGENT_MLS_ID;

  try {
    // GALMLS's OData rejects $expand=Media (501) and 500s on non-standard status
    // tokens. Use the STANDARD DD status values (spaced), no $expand, and never
    // fall back to an unfiltered query — returning other agents'/sold listings as
    // site inventory would violate IDX display + attribution rules.
    const agentClause = (scope === "agent" && agentId)
      ? ` and (ListAgentMlsId eq '${agentId}' or CoListAgentMlsId eq '${agentId}')`
      : "";
    const statusFilter = (arr) => "(" + arr.map(s => `StandardStatus eq '${s}'`).join(" or ") + ")";
    const FOR_SALE = ["Active", "Active Under Contract", "Coming Soon", "Pending"];

    // Progressively narrower filters, all with valid enum values, orderby optional.
    const filters = [statusFilter(FOR_SALE), statusFilter(["Active", "Pending"]), statusFilter(["Active"])];
    const variants = [];
    for (const f of filters) {
      const base = `Property?$filter=${encodeURIComponent(f + agentClause)}`;
      variants.push(`${base}&$orderby=ModificationTimestamp desc&$top=${PAGE_SIZE}`);
      variants.push(`${base}&$top=${PAGE_SIZE}`);
    }

    let raw = null, usedVariant = -1;
    const attempts = [];
    for (let i = 0; i < variants.length; i++) {
      try {
        raw = await odataAll(variants[i]);
        usedVariant = i;
        break;
      } catch (err) {
        attempts.push(`v${i}: ${err.message.slice(0, 160)}`);
      }
    }
    if (raw === null) throw new Error("ODATA all filtered variants failed :: " + attempts.join(" | "));

    const listings = raw.map(normalize).filter(Boolean);
    await attachOpenHouses(listings);

    if (req.query.debug) {
      return res.status(200).json({
        ok: true,
        scope,
        agentIdConfigured: Boolean(agentId),
        rawCount: raw.length,
        displayedCount: listings.length,
        byStatus: listings.reduce((a, l) => ((a[l.status] = (a[l.status] || 0) + 1), a), {}),
        withPhotos: listings.filter(l => l.photos.length).length,
        usedVariant,
        attempts,
        sampleAgentIds: [...new Set(raw.map(r => r.ListAgentMlsId).filter(Boolean))].slice(0, 10),
        ms: Date.now() - started
      });
    }

    res.setHeader("Cache-Control",
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`);
    return res.status(200).json({
      listings,
      count: listings.length,
      source: "Greater Alabama MLS",
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error("[idx]", err.message);
    // Never leak the credential or the raw upstream body to the browser.
    const kind = err.message.startsWith("CONFIG") ? 500
               : err.message.startsWith("AUTH")   ? 502
               : 502;
    return res.status(kind).json({
      listings: [],
      error: err.message.split(":")[0] || "UPSTREAM",
      message: "Listing data is temporarily unavailable."
    });
  }
}
