const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

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


export { parseQuery, phraseCandidates, rowText, rowMatchesText, rowMatchesType, TYPE_MATCH };
