/* ============================================================
   Michelle Creamer — IDX PHOTO proxy  (Vercel serverless function)
   ------------------------------------------------------------
   WHY THIS FILE EXISTS
   GALMLS/Paragon rejects `$expand=Media` on the Property resource
   (HTTP 501 Not Implemented). That means /api/listings can return
   every fact about a listing EXCEPT its pictures.

   So photos come from a second, separate request against the Media
   resource, and only for the listings a visitor is actually looking
   at. Pulling media for all ~200 listings up front would be slow and
   would hammer the MLS for pictures nobody sees.

   This file is deliberately SELF-CONTAINED (its own token + OData
   helpers, duplicated from api/listings.js). It does not import from
   api/listings.js, so a mistake here can never break the listing
   feed that is already working in production.

   ENVIRONMENT VARIABLES (Vercel → Settings → Environment Variables)
     MLS_CLIENT_ID       e.g. AISCidx
     MLS_CLIENT_SECRET   the vendor password

   ENDPOINTS
     GET /api/media?keys=K1,K2,K3   → { media: { K1:[url,...], ... } }
     GET /api/media?keys=K1&full=1  → all photos for one listing (detail page)
     GET /api/media?probe=1         → diagnostics: what the MLS actually supports
     GET /api/media?agent=Creamer   → find an agent's ListAgentMlsId
   ============================================================ */

const TOKEN_URL    = "https://galmls.paragonrels.com/OData/GALMLS/identity/connect/token";
const SERVICE_ROOT = "https://galmls.paragonrels.com/OData/GALMLS/DD1.7";

const MAX_KEYS        = 24;             // most cards a visitor sees in one scroll burst
const PHOTOS_PER_CARD = 1;              // card only needs the lead photo
const PHOTOS_FULL     = 40;             // detail-page gallery cap
const MEDIA_TOP       = 400;            // OData $top for a batched media pull
const CACHE_SECONDS   = 60 * 60 * 6;    // 6h at the CDN edge — photos change rarely
const BATCH_CONCURRENCY = 6;            // parallel per-key requests when batching fails

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

  // Never echo the body — it can contain the credential.
  if (!res.ok) throw new Error(`AUTH: token request failed (${res.status})`);

  const json = await res.json();
  if (!json.access_token) throw new Error("AUTH: no access_token in response");

  const ttl = Number(json.expires_in) || 3600;
  _token = { value: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return _token.value;
}

async function odata(path, { retry = true } = {}) {
  const token = await getToken();
  const res = await fetch(`${SERVICE_ROOT}/${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
  });

  if (res.status === 401 && retry) {
    _token = null;
    return odata(path, { retry: false });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ODATA ${res.status} on ${path.split("?")[0]}: ${body.slice(0, 220)}`);
  }
  return res.json();
}

/* ---------- what counts as a displayable photo ---------- */

/* Documents, disclosures and branded virtual tours are in the same Media
   resource as photos. Showing a PDF thumbnail as a house picture would look
   broken, and branded tours can breach IDX display rules, so both are dropped. */
const BAD_CATEGORY = /document|disclosure|branded|virtual\s*tour|floor\s*plan\s*pdf|logo/i;
const IMAGE_EXT    = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

/* Paragon does not guarantee the RESO field name for the picture link, so find it. */
const URL_FIELDS   = ["MediaURL", "MediaUrl", "Url", "URL", "MediaHTTPURL", "PhotoURL", "LargePhotoURL"];
const ORDER_FIELDS = ["Order", "MediaOrder", "PhotoNumber", "Sequence", "DisplayOrder"];
const KEY_FIELDS   = ["ResourceRecordKey", "ResourceRecordKeyNumeric", "ListingKey",
                      "ListingKeyNumeric", "ListingId", "ResourceRecordId"];

function pickUrl(row) {
  for (const f of URL_FIELDS) {
    const v = row[f];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  // Last resort: any string field that looks like an image link.
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v) && IMAGE_EXT.test(v)) return v;
  }
  return null;
}

function pickOrder(row) {
  for (const f of ORDER_FIELDS) {
    const v = row[f];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  }
  return 9999;
}

function isPhoto(row) {
  const cat  = String(row.MediaCategory || row.MediaType || row.ImageOf || "");
  if (BAD_CATEGORY.test(cat)) return false;
  const url = pickUrl(row);
  if (!url) return false;
  // If the server tells us it's a photo, believe it. Otherwise require an image
  // extension so we never render a PDF link inside an <img>.
  if (/photo|image|picture/i.test(cat)) return true;
  return IMAGE_EXT.test(url) || cat === "";
}

/* Which requested key does this media row belong to? */
function rowKey(row, wanted) {
  for (const f of KEY_FIELDS) {
    if (row[f] == null) continue;
    const v = String(row[f]);
    if (wanted.has(v)) return v;
  }
  return null;
}

/* Turn raw media rows into { key: [url, ...] }, newest-first-photo order. */
function groupMedia(rows, keys, perKey) {
  const wanted = new Set(keys.map(String));
  const buckets = new Map();
  for (const row of rows || []) {
    if (!isPhoto(row)) continue;
    const k = rowKey(row, wanted);
    if (!k) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push({ url: pickUrl(row), order: pickOrder(row),
                          preferred: row.PreferredPhotoYN === true });
  }
  const out = {};
  for (const [k, arr] of buckets) {
    arr.sort((a, b) => (b.preferred - a.preferred) || (a.order - b.order));
    // De-duplicate: some servers return the same picture at several sizes.
    const seen = new Set();
    out[k] = arr.map(x => x.url).filter(u => (seen.has(u) ? false : (seen.add(u), true)))
                .slice(0, perKey);
  }
  return out;
}

/* ---------- query shapes, most efficient first ----------
   GALMLS has already been caught 500-ing on long `or` chains in the status
   filter (see api/listings.js). So: try to get every listing's photos in one
   request; if the server refuses, drop to one request per listing. */

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const orChain = (keys, field, quoted) =>
  "(" + keys.map(k => `${field} eq ${quoted ? q(k) : Number(k)}`).join(" or ") + ")";

const BATCH_SHAPES = [
  { name: "rrk-or-order",
    build: ks => `Media?$filter=${encodeURIComponent(orChain(ks, "ResourceRecordKey", true))}&$orderby=Order&$top=${MEDIA_TOP}` },
  { name: "rrk-or",
    build: ks => `Media?$filter=${encodeURIComponent(orChain(ks, "ResourceRecordKey", true))}&$top=${MEDIA_TOP}` },
  { name: "rrk-in",
    build: ks => `Media?$filter=${encodeURIComponent(`ResourceRecordKey in (${ks.map(q).join(",")})`)}&$top=${MEDIA_TOP}` },
  { name: "lk-or",
    build: ks => `Media?$filter=${encodeURIComponent(orChain(ks, "ListingKey", true))}&$top=${MEDIA_TOP}` },
  { name: "rrkn-or",
    build: ks => ks.every(k => /^\d+$/.test(k))
      ? `Media?$filter=${encodeURIComponent(orChain(ks, "ResourceRecordKeyNumeric", false))}&$top=${MEDIA_TOP}`
      : null }
];

const SINGLE_SHAPES = [
  { name: "rrk-one",
    build: k => `Media?$filter=${encodeURIComponent(`ResourceRecordKey eq ${q(k)}`)}&$top=${PHOTOS_FULL}` },
  { name: "nav",
    build: k => `Property(${q(k)})/Media?$top=${PHOTOS_FULL}` },
  { name: "lk-one",
    build: k => `Media?$filter=${encodeURIComponent(`ListingKey eq ${q(k)}`)}&$top=${PHOTOS_FULL}` },
  { name: "rrkn-one",
    build: k => /^\d+$/.test(k)
      ? `Media?$filter=${encodeURIComponent(`ResourceRecordKeyNumeric eq ${Number(k)}`)}&$top=${PHOTOS_FULL}`
      : null }
];

/* Remember the shape that worked so later requests go straight to it. */
let _batchShape  = null;
let _singleShape = null;

/* Both fetchers report whether the MLS ANSWERED (even with zero photos) or
   ERRORED on every attempt. That difference matters: "this listing has no
   photos" is a real answer the browser can cache, while "the MLS is down"
   must not be cached as an empty result — otherwise a five-minute outage
   leaves cards reading "Photo not in MLS" for the rest of the visit. */

async function fetchBatched(keys, notes) {
  const shapes = _batchShape ? [_batchShape, ...BATCH_SHAPES.filter(s => s !== _batchShape)] : BATCH_SHAPES;
  let answered = false, used = null;

  for (const shape of shapes) {
    const path = shape.build(keys);
    if (!path) continue;
    try {
      const page = await odata(path);
      const rows = page.value || [];
      answered = true;
      // A shape that returns zero rows may be silently wrong (e.g. filtering on a
      // field the server ignores). Only lock it in once it actually produces photos.
      if (rows.length) {
        _batchShape = shape;
        notes.push(`batch:${shape.name} ok (${rows.length} rows)`);
        return { rows, answered: true, used: `batch:${shape.name}` };
      }
      used = used || `batch:${shape.name}`;
      notes.push(`batch:${shape.name} returned 0 rows`);
    } catch (err) {
      notes.push(`batch:${shape.name} ${err.message.slice(0, 120)}`);
    }
  }
  return { rows: [], answered, used };
}

async function fetchPerKey(keys, notes) {
  const shapes = _singleShape ? [_singleShape, ...SINGLE_SHAPES.filter(s => s !== _singleShape)] : SINGLE_SHAPES;
  const rows = [];
  const queue = keys.slice();
  let answered = false, used = null;

  const worker = async () => {
    while (queue.length) {
      const key = queue.shift();
      for (const shape of shapes) {
        const path = shape.build(key);
        if (!path) continue;
        try {
          const page = await odata(path);
          const got = page.value || (Array.isArray(page) ? page : []);
          answered = true;
          used = used || `single:${shape.name}`;
          if (got.length) {
            if (!_singleShape) { _singleShape = shape; notes.push(`single:${shape.name} ok`); }
            // Navigation-property results carry no key field — stamp it on.
            for (const r of got) if (rowKey(r, new Set([key])) === null) r.ResourceRecordKey = key;
            rows.push(...got);
            break;
          }
        } catch (err) {
          if (!_singleShape) notes.push(`single:${shape.name} ${err.message.slice(0, 100)}`);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, keys.length) }, worker));
  return { rows, answered, used };
}

/* ---------- probe: ask the MLS what it actually supports ---------- */
async function probe(res) {
  const out = { ok: true, ranAt: new Date().toISOString(), steps: {} };
  const step = async (name, fn) => {
    try { out.steps[name] = await fn(); }
    catch (err) { out.steps[name] = { error: err.message.slice(0, 400) }; }
  };

  // 1. Which resources are licensed at all?
  await step("entitySets", async () => {
    const token = await getToken();
    const r = await fetch(`${SERVICE_ROOT}/$metadata`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/xml" }
    });
    const xml = await r.text();
    const sets = [...xml.matchAll(/<EntitySet\s+Name="([^"]+)"/g)].map(m => m[1]);
    const mediaProps = [...xml.matchAll(/<EntityType\s+Name="Media"[\s\S]*?<\/EntityType>/g)]
      .flatMap(b => [...b[0].matchAll(/<Property\s+Name="([^"]+)"/g)].map(m => m[1]));
    return { status: r.status, count: sets.length, sets, hasMedia: sets.includes("Media"), mediaProps };
  });

  // 2. Grab one real listing key to test media against.
  let sampleKey = null, sampleId = null;
  await step("sampleListing", async () => {
    const page = await odata(
      `Property?$filter=${encodeURIComponent("StandardStatus eq 'Active'")}&$top=1`);
    const row = (page.value || [])[0];
    if (!row) return { error: "no active listing returned" };
    sampleKey = String(row.ListingKey ?? row.ListingId ?? "");
    sampleId  = String(row.ListingId ?? "");
    const urlish = Object.entries(row)
      .filter(([, v]) => typeof v === "string" && /^https?:\/\//i.test(v))
      .map(([k, v]) => `${k}=${v.slice(0, 110)}`);
    return {
      listingKey: sampleKey, listingId: sampleId,
      photosCount: row.PhotosCount ?? row.PicturesCount ?? null,
      fieldCount: Object.keys(row).length,
      urlFields: urlish,
      photoishFields: Object.keys(row).filter(k => /photo|media|picture|image|tour/i.test(k)),
      fields: Object.keys(row).sort()
    };
  });

  // 3. Try every media shape against that one key and report each result.
  await step("mediaShapes", async () => {
    if (!sampleKey) return { error: "no sample key" };
    const results = {};
    const tries = [
      ...SINGLE_SHAPES.map(s => [s.name, s.build(sampleKey)]),
      ["rrk-batch2", BATCH_SHAPES[1].build([sampleKey])],
      ["listingId-one", sampleId
        ? `Media?$filter=${encodeURIComponent(`ListingId eq ${q(sampleId)}`)}&$top=5` : null],
      ["media-bare", `Media?$top=3`]
    ];
    for (const [name, path] of tries) {
      if (!path) { results[name] = "skipped"; continue; }
      try {
        const page = await odata(path);
        const rows = page.value || (Array.isArray(page) ? page : []);
        results[name] = {
          rows: rows.length,
          sampleFields: rows[0] ? Object.keys(rows[0]).sort() : [],
          sampleRow: rows[0] ? Object.fromEntries(Object.entries(rows[0])
            .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 130) : v])) : null
        };
      } catch (err) { results[name] = err.message.slice(0, 260); }
    }
    return results;
  });

  // 4. Is legacy RETS available as a fallback route to photos?
  await step("retsLogin", async () => {
    const id = process.env.MLS_CLIENT_ID, secret = process.env.MLS_CLIENT_SECRET;
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const r = await fetch(
      "https://galmls.paragonrels.com/rets/fnisrets.aspx/GALMLS/login?rets-version=rets/1.7.2",
      { headers: { Authorization: `Basic ${basic}`, "RETS-Version": "RETS/1.7.2",
                   "User-Agent": "AISyndicate/1.0" } });
    const body = await r.text();
    return { status: r.status, getObjectAdvertised: /GetObject/i.test(body),
             head: body.replace(/\s+/g, " ").slice(0, 260) };
  });

  return res.status(200).json(out);
}

/* ---------- agent lookup: find a real ListAgentMlsId ---------- */
async function findAgent(name, res) {
  const out = { ok: true, query: name, matches: [], notes: [] };
  const needle = String(name).replace(/'/g, "''");

  const tries = [
    ["member-last",  `Member?$filter=${encodeURIComponent(`contains(MemberLastName,'${needle}')`)}&$top=25`],
    ["member-full",  `Member?$filter=${encodeURIComponent(`contains(MemberFullName,'${needle}')`)}&$top=25`],
    ["prop-active",  `Property?$filter=${encodeURIComponent(`contains(ListAgentFullName,'${needle}') and StandardStatus eq 'Active'`)}&$top=25`],
    ["prop-any",     `Property?$filter=${encodeURIComponent(`contains(ListAgentFullName,'${needle}')`)}&$top=25`],
    ["prop-colist",  `Property?$filter=${encodeURIComponent(`contains(CoListAgentFullName,'${needle}')`)}&$top=25`]
  ];

  const seen = new Map();
  for (const [label, path] of tries) {
    try {
      const page = await odata(path);
      const rows = page.value || [];
      out.notes.push(`${label}: ${rows.length} rows`);
      for (const r of rows) {
        const id   = r.MemberMlsId || r.MemberKey || r.ListAgentMlsId || r.CoListAgentMlsId;
        const full = r.MemberFullName ||
                     [r.MemberFirstName, r.MemberLastName].filter(Boolean).join(" ") ||
                     r.ListAgentFullName || r.CoListAgentFullName;
        if (!id) continue;
        const k = `${id}|${full}`;
        if (seen.has(k)) { seen.get(k).seenIn.push(label); continue; }
        seen.set(k, {
          mlsId: String(id), fullName: full || "",
          office: r.OfficeName || r.ListOfficeName || r.MemberOfficeName || "",
          email:  r.MemberEmail || r.ListAgentEmail || "",
          phone:  r.MemberPreferredPhone || r.ListAgentPreferredPhone || "",
          seenIn: [label]
        });
      }
    } catch (err) { out.notes.push(`${label}: ${err.message.slice(0, 150)}`); }
  }
  out.matches = [...seen.values()];
  return res.status(200).json(out);
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  const started = Date.now();
  try {
    if (req.query.probe) return await probe(res);
    if (req.query.agent) return await findAgent(req.query.agent, res);

    const keys = String(req.query.keys || "")
      .split(",").map(s => s.trim()).filter(Boolean)
      .filter((k, i, a) => a.indexOf(k) === i)
      .slice(0, MAX_KEYS);

    if (!keys.length) {
      return res.status(400).json({ media: {}, error: "BADREQUEST",
        message: "Pass ?keys=<ListingKey>[,<ListingKey>...]" });
    }

    const perKey = req.query.full ? PHOTOS_FULL : PHOTOS_PER_CARD;
    const notes  = [];

    /* Get the token first. If the credentials are missing or rejected, say so
       plainly instead of burning five query attempts and reporting it as
       "no photos". */
    await getToken();

    const batch = await fetchBatched(keys, notes);
    let rows = batch.rows, answered = batch.answered, used = batch.used;

    if (!rows.length) {
      notes.push("falling back to one request per listing");
      const single = await fetchPerKey(keys, notes);
      rows = single.rows;
      answered = answered || single.answered;
      used = single.used || used;
    }

    /* Nothing came back AND nothing ever answered = the MLS is unreachable, not
       a set of photoless listings. Fail loudly so neither the CDN nor the
       browser caches "no photos" for six hours. */
    if (!rows.length && !answered) {
      throw new Error("UPSTREAM: every media query failed :: " + notes.join(" | ").slice(0, 300));
    }

    const media = groupMedia(rows, keys, perKey);
    // Requested-but-empty keys get [] so the browser stops asking for them again.
    for (const k of keys) if (!media[k]) media[k] = [];

    res.setHeader("Cache-Control",
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`);
    return res.status(200).json({
      media,
      requested: keys.length,
      withPhotos: Object.values(media).filter(a => a.length).length,
      strategy: used || "none",          // what THIS request actually used
      notes: req.query.debug ? notes : undefined,
      ms: Date.now() - started
    });

  } catch (err) {
    console.error("[media]", err.message);
    const code = err.message.startsWith("CONFIG") ? 500 : 502;
    return res.status(code).json({
      media: {},
      error: err.message.split(":")[0] || "UPSTREAM",
      message: "Listing photos are temporarily unavailable."
    });
  }
}
