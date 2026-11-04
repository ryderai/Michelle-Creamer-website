const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

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

/* LOCATION IS A HINT, NOT A VETO (3 Nov 2026).
   People type the city they know: "4640 Amberley Dr, Vestavia Hills, AL 35242".
   The MLS often stores another city for the same house (3 Nov 2026 sample of
   48 of zip 35242's 429 listings: 34 BIRMINGHAM, 10 HOOVER, 4 VESTAVIA HILLS;
   her own 4640 Amberley Drive is BIRMINGHAM). Every typed word used to be
   required, so the city decided whether the house showed. Now, with a house
   number AND a street typed, city / state / zip only PREFER matching rows
   (see preferSoft): if no row is in that city, the street match still shows. */
const PLACE_WORDS = new Set([
  "VESTAVIA","HILLS","VESTAVIAHILLS","BIRMINGHAM","BHAM","HOOVER","MOUNTAIN","BROOK",
  "HOMEWOOD","LIBERTY","PARK","PELHAM","HELENA","ALABASTER","CHELSEA","INDIAN","SPRINGS",
  "TRUSSVILLE","IRONDALE","LEEDS","GARDENDALE","FULTONDALE","CAHABA","HEIGHTS",
  "AL","ALABAMA","USA","US"
]);
const clean = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9#\s-]/g, " ").replace(/\s+/g, " ").trim();

function parseQuery(raw) {
  const text  = String(raw || "").trim().slice(0, 80);
  /* "number street, city, state zip": everything after the first comma is
     location. Needs a letter right after the number, so "12 , Hoover" and
     "35242, Vestavia Hills" keep today's behaviour. */
  let streetPart = text, placePart = "";
  const comma = text.indexOf(",");
  /* v3: also without a house number ("Amberley Dr, Vestavia Hills"), as long
     as the part before the comma has letters. "35242, Hoover" and "12 , Hoover"
     keep today's behaviour. */
  if (comma > 0 && /[A-Za-z]{2}/.test(text.slice(0, comma)) &&
      !/^\s*\d+\s*$/.test(text.slice(0, comma)) &&
      /* "Unit 3, 4640 Amberley Dr": the street is AFTER the comma — keep the
         whole text as before rather than treat the address as a city. */
      !/^\s*\d{1,6}[A-Za-z]?\s+[A-Za-z]/.test(text.slice(comma + 1))) {
    streetPart = text.slice(0, comma);
    placePart  = text.slice(comma + 1);
  }
  const upper = clean(streetPart);
  const tokens = upper ? upper.split(" ") : [];
  const out = { text, upper, tokens, mlsNumber: null, zip: null, streetNumber: null,
                numberMayBeZip: false, words: [], needles: [], soft: [] };
  const placeTokens = clean(placePart).split(" ").filter(Boolean);
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
  /* No comma: peel city / zip words off the END only when a street-type word
     (DR, CT, WAY...) comes before them — "4640 Amberley Drive Vestavia",
     "Amberley Dr Vestavia Hills" — so a street like "Old Leeds" or a place
     search like "Liberty Park" / "Vestavia Hills 35242" is never cut down.
     Never when the leading number is five digits (it may be a zip). */
  if (!placePart && !out.numberMayBeZip) {
    let cut = rest.length;
    while (cut > 1 && (PLACE_WORDS.has(rest[cut - 1]) || /^\d{5}(-\d{4})?$/.test(rest[cut - 1]))) cut--;
    const head = rest.slice(0, cut);
    const lastReal = [...head].reverse().find(w => !NOISE_WORDS.has(w));
    if (cut < rest.length && lastReal && STREET_SUFFIXES.has(lastReal) &&
        head.some(w => !STREET_SUFFIXES.has(w))) {
      placeTokens.unshift(...rest.slice(cut));
      rest = head;
    }
  }
  /* Words after the comma are a city / state / zip (soft: they rank and
     prefer, never veto). A unit ("Apt 4B", "Ste 200", "#5") is set aside;
     a street-type word stays a normal required word, as before. */
  const UNIT_WORDS = new Set(["APT","UNIT","STE","SUITE","#","LOT","BLDG","BUILDING","FL","FLOOR","RM","ROOM"]);
  const softTokens = [], hardTokens = [];
  for (let i = 0; i < placeTokens.length; i++) {
    const w = placeTokens[i];
    /* A unit ("Ste 200", "Fl 2", "#5") is set aside: the MLS rarely stores it
       the way it is typed, so it must not veto the building's address. */
    if (UNIT_WORDS.has(w)) { if (placeTokens[i + 1]) i++; continue; }
    if (/^#/.test(w)) continue;
    if (STREET_SUFFIXES.has(w) && !PLACE_WORDS.has(w)) { hardTokens.push(w); continue; }
    softTokens.push(w);
  }
  out.soft = softTokens.filter(w => w.length > 1 && !["AL","ALABAMA","USA","US"].includes(w))
                       .map(w => w.replace(/-\d{4}$/, ""));
  rest = rest.concat(hardTokens);

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
  /* "EAGLEWOOD" typed, "EAGLE WOOD" stored: words may also match the street
     with spaces removed — but only starting at the START of a street word, so
     "DAVE" can never match the middle of "GRAND AVENUE". */
  const streetWords = String(row.StreetName || "").toUpperCase().split(/\s+/).filter(Boolean)
    .concat(String(row.StreetSuffix || "").toUpperCase().split(/\s+/).filter(Boolean));
  const joinedFrom = streetWords.map((_, i) => streetWords.slice(i).join(""));
  return needles.every(n => hay.includes(n) || joinedFrom.some(j => j.startsWith(n.replace(/\s+/g, ""))));
}

/* Location typed after a street (soft words): if some rows are in that city /
   zip, show only those; if none are, show every street match, best first.
   This keeps "100 Main St, Hoover" from listing Trussville's 100 Main St, and
   still finds 4640 Amberley (stored BIRMINGHAM) typed with "Vestavia Hills". */
function preferSoft(rows, parsed) {
  const soft = (parsed && parsed.soft) || [];
  if (!soft.length || !rows.length) return rows;
  const score = (r) => { const h = rowText(r); return soft.filter(w => h.includes(w)).length; };
  const scored = rows.map((r, i) => [r, score(r), i]);
  const full = scored.filter(x => x[1] === soft.length);
  if (full.length) return full.map(x => x[0]);
  return scored.sort((a, b) => (b[1] - a[1]) || (a[2] - b[2])).map(x => x[0]);
}

/* ---------- CLOSEST MATCHES (v3, 3 Nov 2026) ----------
   When nothing matches exactly, a typo ("Amberly"), a joined or split word
   ("Eaglewood" / "EAGLE WOOD"), or a wrong house number should still put the
   right street in front of the visitor — clearly labelled as closest matches,
   never passed off as an exact hit. */
/* Edit distance where swapping two neighbouring letters counts as ONE typo
   ("AMBRELEY" vs "AMBERLEY" = 1). Inputs are capped at 40 letters. */
function lev(a, b) {
  a = a.slice(0, 40); b = b.slice(0, 40);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(new Array(b.length).fill(0)));
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
const squash = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* How far the typed street is from this row's street (0 = same). Infinity = not
   close enough to show. Compares with spaces removed, whole street and word by
   word, against StreetName and SubdivisionName. */
function streetDistance(row, words) {
  const typed = squash(words.join(""));
  if (typed.length < 3) return Infinity;
  const tol = (n) => (n >= 9 ? 2 : n >= 5 ? 1 : 0);
  let best = Infinity;
  /* Street name: whole-name distance, a starts-with for long words only (6+
     letters, so "HILL" can't pull in HILLCREST / HILLSIDE / HILLTOP), and a
     word-by-word typo check ("AMBERLY" vs "AMBERLEY"). */
  const street = squash(row.StreetName);
  if (street) {
    if (street === typed) return 0;
    if (Math.min(street.length, typed.length) >= 6 && (street.startsWith(typed) || typed.startsWith(street))) best = Math.min(best, 0.5);
    const d = lev(typed, street);
    if (d <= tol(Math.max(typed.length, street.length))) best = Math.min(best, d);
    for (const tw of words.map(squash).filter(w => w.length >= 5)) {
      for (const nw of String(row.StreetName).toUpperCase().split(/\s+/).map(squash).filter(w => w.length >= 5)) {
        const dw = lev(tw, nw);
        if (dw <= tol(Math.max(tw.length, nw.length))) best = Math.min(best, dw + 0.25);
      }
    }
  }
  /* Subdivision: whole-name typo only — never a partial word, so a street
     typed as "Liberty Pkwy" doesn't pull in every house in LIBERTY PARK. */
  const sub = squash(row.SubdivisionName);
  if (sub && sub.length >= 5) {
    const ds = lev(typed, sub);
    if (ds <= tol(Math.max(typed.length, sub.length))) best = Math.min(best, ds + 0.5);
  }
  return best;
}

const CLOSEST_MAX = 24;
async function closestMatches(clauses, p, pool, { orderby, deadlineAt, droppedFilters = 0 }) {
  const parsed = clauses.parsed;
  const words = (parsed.words || []).filter(w => !/^\d+$/.test(w));
  if (!words.length) return [];
  const byKey = new Map();
  for (const r of pool || []) byKey.set(r.ListingKey, r);

  /* Ask the MLS for the street by the first five letters of its longest word —
     "AMBER" finds AMBERLEY even when "AMBERLY" was typed; "EAGLE" finds
     EAGLE WOOD when "EAGLEWOOD" was typed. One extra fan-out, only on a miss. */
  const longest = words.slice().sort((a, b) => b.length - a.length)[0];
  /* Refinements the MLS already refused for this search are not re-sent;
     they are still checked locally by rowMatchesAll below. */
  const extra = clauses.essential.filter(c => c !== clauses.textClauseUsed)
                       .concat(droppedFilters ? [] : clauses.droppable);
  const close = (r) => Number.isFinite(streetDistance(r, words)) && rowMatchesAll(r, p, null);
  const ask = async (prefix) => {
    if (prefix.length < 3 || Date.now() > deadlineAt - 2000) return;
    try {
      const out = await textSearchRows({ ...parsed, words: [prefix], needles: [prefix] }, {
        required: clauses.required, extra, top: WINDOW_TOP, orderby, select: selectFor(true),
        keep: null, deadlineAt
      });
      if (!out.allFailed) for (const r of out.rows) byKey.set(r.ListingKey, r);
    } catch { /* closest matches are a bonus; never break the search for them */ }
  };
  /* First five letters, then — only if that found nothing close — the first
     three, for a typo early in the word ("Ambreley", "Mainn"). */
  await ask(longest.slice(0, Math.min(5, longest.length)));
  if (![...byKey.values()].some(close) && longest.length > 3) await ask(longest.slice(0, 3));

  const wantNum = Number(parsed.streetNumber || NaN);
  const scored = [];
  for (const r of byKey.values()) {
    if (!rowMatchesAll(r, p, null)) continue;            // price / beds / type still apply
    const d = streetDistance(r, words);
    if (!Number.isFinite(d)) continue;
    const numGap = Number.isFinite(wantNum) ? Math.abs(Number(r.StreetNumber) - wantNum) : 0;
    scored.push([r, d, Number.isFinite(numGap) ? numGap : 1e9]);
  }
  scored.sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]));
  const ranked = preferSoft(scored.map(x => x[0]), parsed);
  return { rows: ranked.slice(0, CLOSEST_MAX), more: ranked.length > CLOSEST_MAX };
}


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


export { parseQuery, phraseCandidates, rowText, rowMatchesText, rowMatchesType, TYPE_MATCH, preferSoft, streetDistance };
