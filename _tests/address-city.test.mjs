/* 3 Nov 2026 — "sometimes it shows, sometimes it doesn't".
   Rows are hand-built from fields the live feed returned on 3 Nov 2026 (street,
   city, zip, subdivision as shown on the site). Runs against whichever
   api/listings.js _extracted-logic.mjs was regenerated from; the ranking checks
   are skipped (not faked) when preferSoft does not exist. */
import * as L from './_extracted-logic.mjs';
const { parseQuery, rowMatchesText } = L;
let pass=0, fail=0, skip=0; const ok=(n,c,x="")=>{ if(c) pass++; else { fail++; console.log("  FAIL "+n+(x?" -> "+x:"")); } };
const row=(k,num,name,suf,city,zip,sub="")=>({ListingKey:k,ListingId:k,UnparsedAddress:`${num} ${name} ${suf}`,
  StreetNumber:num,StreetName:name,StreetSuffix:suf,City:city,StateOrProvince:"AL",PostalCode:zip,SubdivisionName:sub});
const AMBERLEY = row("21468815","4640","AMBERLEY","DRIVE","BIRMINGHAM","35242");
const EAGLE    = row("21457031","4700","EAGLE WOOD","COURT","BIRMINGHAM","35242","EAGLE POINT");
const KNOLL    = row("21468895","3941","KNOLLWOOD","TRACE","VESTAVIA HILLS","35243","KNOLLWOOD TRACE");
const GREY     = row("21465688","1099","GREYSTONE COVE","DRIVE","HOOVER","35242","GREYSTONE COVE");
const KENMORE  = row("21463531","7713","KENMORE","PLACE","VESTAVIA HILLS","35242","LIBERTY PARK");
const CALED    = row("21464876","922","CALEDONIAN","WAY","VESTAVIA HILLS","35242","LIBERTY PARK");
const DECOY    = row("1","4640","OAK RIDGE","ROAD","VESTAVIA HILLS","35242");
const MAIN_H   = row("2","100","MAIN","STREET","HOOVER","35244");
const MAIN_T   = row("3","100","MAIN","STREET","TRUSSVILLE","35173");
const OLDLEEDS = row("4","123","OLD LEEDS","ROAD","BIRMINGHAM","35210");
const OLDMONT  = row("5","123","OLD MONTGOMERY","HIGHWAY","HOMEWOOD","35209");
const PINE     = row("6","4700","PINE","CT","ALEXANDER CITY","35010");
const finds=(q,r)=>rowMatchesText(r,parseQuery(q));

// The 7 searches that MISSED live on 3 Nov 2026 must hit
for (const [q,r] of [
  ["4640 Amberley Dr, Vestavia Hills, AL 35242",AMBERLEY],["4640 Amberley Drive Vestavia",AMBERLEY],
  ["4640 Amberley Drive Liberty Park",AMBERLEY],["4700 Eagle Wood Ct, Vestavia Hills, AL 35242",EAGLE],
  ["4700 Eaglewood Ct",EAGLE],["3941 Knollwood Trace, Vestavia Hills, AL 35242",KNOLL],
  ["1099 Greystone Cove Dr, Birmingham, AL 35242",GREY],
]) ok(`live miss now hits: "${q}"`, finds(q,r));

// Every search that HIT live must still hit
for (const [q,r] of [
  ["4640 Amberley Drive",AMBERLEY],["4640 Amberley Dr Birmingham AL 35242",AMBERLEY],
  ["7713 Kenmore Place",KENMORE],["7713 Kenmore Pl, Vestavia Hills, AL 35242",KENMORE],["7713 Kenmore Pl Vestavia Hills AL",KENMORE],["7713 Kenmore",KENMORE],
  ["922 Caledonian Way, Vestavia Hills, AL 35242",CALED],["922 Caledonian Way Liberty Park",CALED],
  ["4700 Eagle Wood Ct, Birmingham, AL 35242",EAGLE],["4700 Eagle Wood Court",EAGLE],
  ["3941 Knollwood Trace, Vestavia Hills, AL 35243",KNOLL],["3941 Knollwood Trace",KNOLL],
  ["1099 Greystone Cove Dr, Hoover, AL 35242",GREY],["1099 Greystone Cove Drive",GREY],
]) ok(`live hit still hits: "${q}"`, finds(q,r));

// Precision
ok("same number, different street: no match", !finds("4640 Amberley Dr, Vestavia Hills, AL 35242",DECOY));
ok("4640 Oak Ridge does not match Amberley", !finds("4640 Oak Ridge Rd",AMBERLEY));
ok('"123 Old Leeds" does not match 123 Old Montgomery Hwy', !finds("123 Old Leeds",OLDMONT));
ok('"123 Old Leeds" matches 123 Old Leeds Rd', finds("123 Old Leeds",OLDLEEDS));
ok('"4700 Pine Ctalexander" does not join CT + ALEXANDER CITY', !finds("4700 Pine Ctalexander",PINE));
ok('"12 , Hoover" keeps HOOVER as a real word', !finds("12 , Hoover", row("7","12","ELM","ST","BIRMINGHAM","35242")));
// No house number / leading zip: unchanged
ok('"Vestavia Hills" excludes a Birmingham row', !finds("Vestavia Hills",AMBERLEY));
ok('"Hoover 35242" excludes Kenmore', !finds("Hoover 35242",KENMORE));
ok('"35242 Liberty Park" still requires LIBERTY PARK', !finds("35242 Liberty Park",AMBERLEY) && finds("35242 Liberty Park",KENMORE));
ok("MLS number unchanged", finds("21468815",AMBERLEY) && !finds("21468815",KENMORE));

// preferSoft (city typed after a street)
if (typeof L.preferSoft === "function") {
  const p1 = parseQuery("100 Main St, Hoover");
  const r1 = L.preferSoft([MAIN_T, MAIN_H].filter(r=>rowMatchesText(r,p1)), p1);
  ok("100 Main St, Hoover → only the Hoover row", r1.length===1 && r1[0].ListingKey==="2", JSON.stringify(r1.map(r=>r.City)));
  const p2 = parseQuery("4640 Amberley Dr, Vestavia Hills, AL 35242");
  const r2 = L.preferSoft([AMBERLEY].filter(r=>rowMatchesText(r,p2)), p2);
  ok("no row in Vestavia Hills → Amberley (Birmingham) still shown", r2.length===1 && r2[0].ListingKey==="21468815");
  const p3 = parseQuery("100 Main St, Gadsden");
  const r3 = L.preferSoft([MAIN_T, MAIN_H].filter(r=>rowMatchesText(r,p3)), p3);
  ok("city matches nothing → both street matches kept", r3.length===2);
} else { skip += 3; console.log("  (3 ranking checks skipped: preferSoft not in this version)"); }

console.log(`\n${pass} passed, ${fail} failed${skip?`, ${skip} skipped`:""}`); if (fail) process.exit(1);
