/* v3 (3 Nov 2026): the whole search endpoint, against a stand-in MLS set up the
   way the real one behaved on 3 Nov 2026: City refused (any operator),
   UnparsedAddress refused, one contains() per filter. Rows copy street / city /
   zip as the live feed showed them that day. */
import { makeFakeMls } from './fake-mls.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const MOD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../api/listings.js');
process.env.MLS_CLIENT_ID = "test"; process.env.MLS_CLIENT_SECRET = "test"; process.env.MLS_AGENT_MLS_ID = "creamemi";

let k = 5000;
const mk = (num, name, suf, city, zip, sub = "", extra = {}) => ({
  ListingKey: String(++k), ListingId: String(k), StandardStatus: "Active",
  StreetNumber: num, StreetName: name, StreetSuffix: suf, UnparsedAddress: `${num} ${name} ${suf}`,
  City: city, StateOrProvince: "AL", PostalCode: zip, SubdivisionName: sub,
  ListPrice: 500000, BedroomsTotal: 4, BathroomsTotalInteger: 3, LivingArea: 2500,
  PropertyType: "Residential", PropertySubType: "Single Family Residence", PhotosCount: 5,
  ListOfficeName: "X", ListAgentFullName: "Y", ListAgentMlsId: "other",
  ModificationTimestamp: new Date(Date.now() - k * 1000).toISOString(), ...extra });
const AMBERLEY = mk("4640","AMBERLEY","DRIVE","BIRMINGHAM","35242","",{ListingKey:"21468815",ListingId:"21468815",ListAgentMlsId:"creamemi"});
const EAGLE    = mk("4700","EAGLE WOOD","COURT","BIRMINGHAM","35242","EAGLE POINT");
const KNOLL    = mk("3941","KNOLLWOOD","TRACE","VESTAVIA HILLS","35243","KNOLLWOOD TRACE");
const GREY     = mk("1099","GREYSTONE COVE","DRIVE","HOOVER","35242","GREYSTONE COVE");
const KENMORE  = mk("7713","KENMORE","PLACE","VESTAVIA HILLS","35242","LIBERTY PARK");
const PROV     = mk("655","PROVENCE","DRIVE","VESTAVIA HILLS","35242","LIBERTY PARK");
const KINGS    = mk("7305","KINGS MOUNTAIN","CIRCLE","VESTAVIA HILLS","35242","");
const MAIN_H   = mk("100","MAIN","STREET","HOOVER","35244");
const MAIN_T   = mk("100","MAIN","STREET","TRUSSVILLE","35173");
const OAK1     = mk("200","OAK RIDGE","ROAD","HOOVER","35244","OAK RIDGE");
const rows = [AMBERLEY, EAGLE, KNOLL, GREY, KENMORE, PROV, KINGS, MAIN_H, MAIN_T, OAK1];
for (let i = 0; i < 120; i++) rows.push(mk(String(300 + i), ["CASCADE","PINE","ELM","BIRCH"][i % 4], "LANE",
  ["BIRMINGHAM","HOOVER","PELHAM"][i % 3], ["35242","35244","35124"][i % 3], ""));

const TODAY = { supportsContains: true, maxContains: 1, poisonFields: ["UnparsedAddress"],
  fieldOps: { City: [], StreetName: ["contains","eq"], SubdivisionName: ["contains","eq"], PostalCode: ["contains","eq"] } };
const CITY_OK = { ...TODAY, fieldOps: { ...TODAY.fieldOps, City: ["contains"] } };

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else { fail++; console.log("  FAIL " + n + (x ? " -> " + x : "")); } };
async function call(q, mls = TODAY, extra = {}) {
  const fake = makeFakeMls(rows, mls); globalThis.fetch = fake.fetch;
  const mod = await import(MOD + "?v=" + Math.random());
  let body = null, status = 0; const headers = {};
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; }, setHeader(k, v) { headers[k] = v; } };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q, ...extra } }, res);
  return { body, status, headers, ids: (body.listings || []).map(l => l.id), calls: fake.calls.length };
}

// exact finds, whatever city / zip is typed
for (const [q, want] of [
  ["4640 Amberley Dr, Vestavia Hills, AL 35242", AMBERLEY], ["4640 Amberley Drive Vestavia", AMBERLEY],
  ["4640 Amberley Drive Liberty Park", AMBERLEY], ["4640 Amberley Drive", AMBERLEY],
  ["4700 Eagle Wood Ct, Vestavia Hills, AL 35242", EAGLE], ["3941 Knollwood Trace, Vestavia Hills, AL 35242", KNOLL],
  ["1099 Greystone Cove Dr, Birmingham, AL 35242", GREY], ["Amberley Dr, Vestavia Hills", AMBERLEY],
  ["Amberley Drive Vestavia Hills", AMBERLEY], ["Kenmore Place", KENMORE],
]) { const r = await call(q); ok(`exact: "${q}"`, r.ids.includes(want.ListingKey) && !r.body.approximate, JSON.stringify({ids:r.ids.slice(0,5),approx:r.body.approximate})); }

// closest matches: typo, joined word, wrong number — right house shown, labelled approximate
for (const [q, want] of [
  ["4640 Amberly Dr", AMBERLEY], ["4640 Ambreley Drive, Vestavia Hills", AMBERLEY],
  ["4641 Amberley Drive", AMBERLEY], ["Eaglewood Ct", EAGLE], ["4700 Eaglewood Ct", EAGLE],
  ["Greystone Cv Dr", GREY], ["7713 Kenmor Pl", KENMORE],
]) { const r = await call(q); ok(`closest: "${q}" shows it`, r.ids.includes(want.ListingKey), JSON.stringify({ids:r.ids.slice(0,5),approx:r.body.approximate}));
     ok(`closest: "${q}" is first`, r.ids[0] === want.ListingKey, JSON.stringify(r.ids.slice(0,5))); }
{ const r = await call("4640 Amberly Dr"); ok('typo answer is labelled approximate', r.body.approximate === true); }
{ const r = await call("4700 Eaglewood Ct"); ok('"4700 Eaglewood Ct" is an exact match (space-insensitive)', r.body.approximate === false && r.ids[0] === EAGLE.ListingKey); }

// precision
{ const r = await call("4640 Oak Ridge Rd"); ok('"4640 Oak Ridge Rd" never shows Amberley', !r.ids.includes(AMBERLEY.ListingKey), JSON.stringify(r.ids)); ok('…shows the Oak Ridge street as closest', r.ids.includes(OAK1.ListingKey)); }
{ const r = await call("100 Main St, Hoover"); ok('"100 Main St, Hoover" → only Hoover', r.ids.length === 1 && r.ids[0] === MAIN_H.ListingKey, JSON.stringify(r.ids)); }
{ const r = await call("Qwxyzv Lane"); ok('nonsense street → nothing, not random houses', r.ids.length === 0, JSON.stringify(r.ids)); }
{ const r = await call("21468815"); ok('MLS number unchanged', r.ids.length === 1 && r.ids[0] === "21468815"); }
{ const r = await call("35242"); ok('bare zip unchanged (exact count of 35242 rows)', r.body.total === rows.filter(x => x.PostalCode === "35242").length, String(r.body.total)); }
{ const r = await call("4640 Amberley Drive", TODAY, { minPrice: "900000" }); ok('price filter still applies to closest/exact', r.ids.length === 0, JSON.stringify(r.ids)); }

// city search: refused today → best-effort City question fails safely; when the MLS takes City, all VH rows come back
{ const r = await call("Vestavia Hills"); ok('city refused: no crash, answers 200', r.status === 200 && !r.body.searchUnavailable, JSON.stringify({s:r.status,u:r.body.searchUnavailable})); }
{ const r = await call("Vestavia Hills", CITY_OK); const vh = rows.filter(x => x.City === "VESTAVIA HILLS").map(x => x.ListingKey);
  ok('city accepted: every Vestavia Hills row found', vh.every(id => r.ids.includes(id)), JSON.stringify({got:r.ids.length,want:vh.length})); }

// cache
{ const r = await call("Qwxyzv Lane"); ok('empty answer not cached', /max-age=0/.test(r.headers["Cache-Control"] || ""), r.headers["Cache-Control"]); }
{ const r = await call("4640 Amberley Drive"); ok('search answer cached 15 min + 60 s', r.headers["Cache-Control"] === "public, s-maxage=900, stale-while-revalidate=60", r.headers["Cache-Control"]); }
{ const fake = makeFakeMls(rows, TODAY); globalThis.fetch = fake.fetch; const mod = await import(MOD + "?v=" + Math.random());
  const headers = {}; const res = { status() { return this; }, json() { return this; }, setHeader(k, v) { headers[k] = v; } };
  await mod.default({ query: {} }, res); ok("Michelle's own listings keep 3 h", /s-maxage=10800/.test(headers["Cache-Control"] || ""), headers["Cache-Control"]); }

// ---- second checker's cases (3 Nov 2026, v3 review) ----
{ const r = await call("4640 Amberley Dr, Vestavia Hills, AL 35242"); ok('#1 Amberley typed VH: shown AND flagged placeMismatch', r.ids[0] === AMBERLEY.ListingKey && r.body.placeMismatch === true && r.body.approximate === false); }
{ const r = await call("4640 Amberley Drive"); ok('#1 Amberley typed plainly: no placeMismatch', r.body.placeMismatch === false); }
{ const only = rows.filter(x => x !== MAIN_H); const fake = makeFakeMls(only, TODAY); globalThis.fetch = fake.fetch;
  const mod = await import(MOD + "?v=" + Math.random()); let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "100 Main St, Hoover" } }, res);
  ok('#1 "100 Main St, Hoover" with only a Trussville 100 Main: flagged, not exact-looking', body.placeMismatch === true, JSON.stringify({pm:body.placeMismatch,n:body.listings.length})); }
{ const many = rows.slice(); for (let i = 0; i < 320; i++) many.push(mk(String(900 + i), "MAIN", "STREET", "TRUSSVILLE", "35173"));
  const fake = makeFakeMls(many, TODAY); globalThis.fetch = fake.fetch; const mod = await import(MOD + "?v=" + Math.random());
  let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "Main St, Hoover" } }, res);
  const hasHoover = body.listings.some(l => l.city === "HOOVER");
  ok('#1 "Main St, Hoover" buried by 320 Trussville rows: either Hoover shown or flagged', hasHoover || body.placeMismatch === true, JSON.stringify({hasHoover, pm: body.placeMismatch, trunc: body.truncated})); }
{ /* probe passes, then the street questions fail at search time while City answers 0 */
  const fake = makeFakeMls(rows, TODAY); const base = fake.fetch;
  globalThis.fetch = async (u, o) => { const f = decodeURIComponent(String(u));
    if (/contains\((StreetName|SubdivisionName),'AMBER/.test(f)) return { ok: false, status: 503, text: async () => "down" };
    if (/contains\(City,'AMBER/.test(f)) return { ok: true, status: 200, json: async () => ({ value: [] }) };
    return base(u, o); };
  const mod = await import(MOD + "?v=" + Math.random()); let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "Amberley Dr" } }, res);
  ok('#2 street questions down, City answers 0 → "search unavailable", not "no match"', body.searchUnavailable === true, JSON.stringify({u:body.searchUnavailable,n:body.listings.length})); }
{ const r = await call("Amberley Dr", { ...TODAY, fieldOps: { ...TODAY.fieldOps, StreetName: [], SubdivisionName: [] } });
  ok('#2 street fields refused by the field check → not a plain "no match"', r.body.searchUnavailable === true || r.body.searchLimited === true, JSON.stringify({u:r.body.searchUnavailable,l:r.body.searchLimited})); }
{ const r = await call("Vestavia Hills"); ok('#3 City refused → cityLimited flag + not cached', r.body.cityLimited === true && /max-age=0/.test(r.headers["Cache-Control"]), JSON.stringify({cl:r.body.cityLimited,cc:r.headers["Cache-Control"]})); }
{ const slow = makeFakeMls(rows, TODAY); const base = slow.fetch;
  /* City refused by the field check (as on 3 Nov), and the best-effort City question never answers */
  globalThis.fetch = async (u, o) => { const f = decodeURIComponent(String(u)); if (/contains\(City/.test(f) && !/ZQXJVWQ/.test(f)) { await new Promise((res, rej) => { const t = setTimeout(res, 30000); o && o.signal && o.signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }); }); } return base(u, o); };
  const mod = await import(MOD + "?v=" + Math.random()); let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  const t0 = Date.now(); await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "Zqvx Lane" } }, res); const ms = Date.now() - t0;
  ok('#4 a City that never answers costs at most ~8 s for a no-match search, not 28+', ms < 10000, ms + " ms"); }
{ const G = mk("100","GRAND","AVENUE","BIRMINGHAM","35242"); const fake = makeFakeMls(rows.concat([G]), TODAY); globalThis.fetch = fake.fetch;
  const mod = await import(MOD + "?v=" + Math.random()); let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "100 Dave Ln" } }, res);
  ok('#6 "100 Dave Ln" never matches 100 GRAND AVENUE', !body.listings.some(l => l.id === G.ListingKey), JSON.stringify(body.listings.map(l=>l.address))); }
{ const hills = rows.slice(); for (const n of ["HILLCREST","HILLSIDE","HILLTOP","HILLWOOD"]) for (let i = 0; i < 30; i++) hills.push(mk(String(12 + i * 2), n, "ROAD", "HOOVER", "35244"));
  const fake = makeFakeMls(hills, TODAY); globalThis.fetch = fake.fetch; const mod = await import(MOD + "?v=" + Math.random());
  let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "12 Hill St" } }, res);
  /* The 4 rows numbered 12 on HILL… streets match by the old substring rule too (unchanged); the point is no 96-row "closest" junk. */
  ok('#5 "12 Hill St" adds no closest-match junk', body.approximate === false && body.listings.length <= 4, JSON.stringify({a:body.approximate,n:body.listings.length})); }
{ const lp = rows.slice(); for (const n of ["MOUNTAIN BROOK","MAINLAND","PARKWOOD"]) lp.push(mk("7713", n, "DRIVE", "VESTAVIA HILLS", "35242", "LIBERTY PARK"));
  const fake = makeFakeMls(lp, TODAY); globalThis.fetch = fake.fetch; const mod = await import(MOD + "?v=" + Math.random());
  let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "7713 Liberty Pkwy" } }, res);
  /* 7713 + LIBERTY matching houses in the LIBERTY PARK subdivision is the old (unchanged) substring rule; check no closest-match junk is added. */
  ok('#5 "7713 Liberty Pkwy" adds no closest-match junk', body.approximate === false, JSON.stringify({a:body.approximate,n:body.listings.length})); }
{ const big = rows.slice(); for (let i = 0; i < 60; i++) big.push(mk(String(2000 + i), "AMBERLEY", "WAY", "PELHAM", "35124"));
  const fake = makeFakeMls(big, TODAY); globalThis.fetch = fake.fetch; const mod = await import(MOD + "?v=" + Math.random());
  let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "Amberly Way" } }, res);
  ok('#7 capped closest list says "or more" (countKnown false)', body.approximate === true && body.countKnown === false && body.truncated === true, JSON.stringify({a:body.approximate,ck:body.countKnown,t:body.truncated,n:body.listings.length})); }
{ const r = await call("Unit 3, 4640 Amberley Dr"); ok('#7 "Unit 3, 4640 Amberley Dr" still finds the house', r.ids.includes(AMBERLEY.ListingKey), JSON.stringify(r.ids)); }
{ const r = await call("Ambreley Dr"); ok('#7 "Ambreley Dr" (early typo, no number) finds Amberley as closest', r.ids[0] === AMBERLEY.ListingKey && r.body.approximate === true, JSON.stringify({ids:r.ids.slice(0,3),a:r.body.approximate})); }

// ---- checker re-check (v3b → v3c) ----
{ const many = rows.slice(); for (let i = 0; i < 320; i++) many.push(mk(String(900 + i), "MAIN", "STREET", "TRUSSVILLE", "35173"));
  const fake = makeFakeMls(many, TODAY); globalThis.fetch = fake.fetch; const mod = await import(MOD + "?v=" + Math.random());
  let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "Main St, Hoover" } }, res);
  ok('full window: no false "different city" claim; says too many matches instead', body.placeMismatch === false && body.truncated === true, JSON.stringify({pm:body.placeMismatch,t:body.truncated})); }
{ const r = await call("4640 Amberley Dr, Apt 2"); ok('"4640 Amberley Dr, Apt 2": found, no false city flag', r.ids.includes(AMBERLEY.ListingKey) && r.body.placeMismatch === false, JSON.stringify({ids:r.ids,pm:r.body.placeMismatch})); }
{ const r = await call("4640 Amberley Dr, Vestavia Hills, AL 35242"); ok('real city mismatch still flagged', r.body.placeMismatch === true); }
{ const slow = makeFakeMls(rows, TODAY); const base = slow.fetch; let cityAsks = 0;
  globalThis.fetch = async (u, o) => { const f = decodeURIComponent(String(u));
    if (/ListPrice ge/.test(f) && /contains\(/.test(f)) return { ok: false, status: 500, text: async () => "refused" };
    if (/contains\(City/.test(f) && !/ZQXJVWQ/.test(f)) { cityAsks++; await new Promise((res, rej) => { const t = setTimeout(res, 7000); o && o.signal && o.signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }); }); return { ok: true, status: 200, json: async () => ({ value: [] }) }; }
    return base(u, o); };
  const mod = await import(MOD + "?v=" + Math.random()); let body; const res = { status() { return this; }, json(b) { body = b; return this; }, setHeader() {} };
  const t0 = Date.now(); await mod.default({ query: { scope: "all", page: "1", pageSize: "24", q: "Zqvx Lane", minPrice: "300000" } }, res); const ms = Date.now() - t0;
  ok('refused price filter + slow City: City asked at most twice, under 16 s', cityAsks <= 2 && ms < 16000, JSON.stringify({cityAsks, ms})); }

for (const q of ["4640 Amberley Dr, Ste 200", "4640 Amberley Dr, Fl 2, Birmingham", "4640 Amberley Dr, #5", "4640 Amberley Dr, Apt 4B, Birmingham"]) {
  const r = await call(q); ok(`unit after comma: "${q}" → exact, no false flags`, r.ids[0] === AMBERLEY.ListingKey && !r.body.approximate && !r.body.placeMismatch, JSON.stringify({ids:r.ids,a:r.body.approximate,pm:r.body.placeMismatch})); }

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
