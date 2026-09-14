import { parseQuery, phraseCandidates, rowMatchesText, rowMatchesType } from './_extracted-logic.mjs';
let pass=0, fail=0, section="";
const ok=(n,c,x="")=>{ if(c) pass++; else { fail++; console.log("  FAIL ["+section+"] "+n+(x?" -> "+x:"")); } };
const S=(t)=>{ section=t; console.log("\n-- "+t+" --"); };

const BOULDER={ListingKey:"21463762",ListingId:"21463762",UnparsedAddress:"4413 BOULDER LAKE CIRCLE",
  StreetNumber:"4413",StreetName:"BOULDER LAKE",StreetSuffix:"CIRCLE",City:"VESTAVIA HILLS",
  StateOrProvince:"AL",PostalCode:"35242",SubdivisionName:"LIBERTY PARK",
  PropertyType:"Residential",PropertySubType:"Single Family Residence"};
const FULTON={ListingKey:"21463044",ListingId:"21463044",UnparsedAddress:"547 FULTONBROOK DRIVE",
  StreetNumber:"547",StreetName:"FULTONBROOK",StreetSuffix:"DRIVE",City:"FULTONDALE",
  StateOrProvince:"AL",PostalCode:"35068",SubdivisionName:"FULTONBROOK MANOR",
  PropertyType:"Residential",PropertySubType:"Single Family Residence"};
const DECOY={...BOULDER,ListingKey:"99999",ListingId:"99999",UnparsedAddress:"4413 OAK RIDGE ROAD",
  StreetName:"OAK RIDGE",StreetSuffix:"ROAD",City:"HOOVER",PostalCode:"35244",SubdivisionName:"OAK RIDGE"};
const ZIP4={...BOULDER,ListingKey:"88888",ListingId:"88888",PostalCode:"35242-1234"};
const COVE={...FULTON,ListingKey:"77777",UnparsedAddress:"12 HIDDEN COVE",StreetName:"HIDDEN COVE",
  StreetSuffix:"",City:"HOOVER",SubdivisionName:"THE COVE"};
const CONDO={...FULTON,ListingKey:"555",PropertySubType:"Condominium",UnparsedAddress:"1 TOWER PLACE"};
const TOWN ={...FULTON,ListingKey:"554",PropertySubType:"Townhouse"};
const LOT  ={...FULTON,ListingKey:"556",PropertyType:"Land",PropertySubType:"Unimproved Land"};
const LEASE={...FULTON,ListingKey:"557",PropertyType:"Residential Lease",PropertySubType:"Single Family Residence"};
const COMM ={...FULTON,ListingKey:"558",PropertyType:"Commercial Sale",PropertySubType:"Retail"};
const ALL=[BOULDER,FULTON,DECOY,ZIP4,COVE,CONDO,TOWN,LOT,LEASE,COMM];
const hits=(term)=>ALL.filter(r=>rowMatchesText(r,parseQuery(term)));

S("parsing");
for(const [i,w] of [
 ["4413 Boulder Lake Cir",{streetNumber:"4413",words:"BOULDER,LAKE"}],
 ["4413 Boulder Lake Circle",{streetNumber:"4413",words:"BOULDER,LAKE"}],
 ["21463762",{mlsNumber:"21463762"}],
 ["35242",{zip:"35242"}],
 ["Vestavia Hills 35242",{zip:"35242",words:"VESTAVIA,HILLS"}],
 ["Vestavia Hills",{words:"VESTAVIA,HILLS"}],
]) { const g=parseQuery(i);
  for(const k of Object.keys(w)){ const gv=Array.isArray(g[k])?g[k].join(","):g[k];
    ok(`"${i}".${k}`, gv===w[k], `got ${JSON.stringify(g[k])}`); } }

S("DEFECT 1 regression: suffix-only words must NOT match everything");
for(const t of ["cove","point","trail","loop","run","way","north","place","terrace","highway","alabama"]) {
  const h=hits(t);
  ok(`"${t}" does not match the whole market`, h.length < ALL.length, `matched ${h.length}/${ALL.length}`);
}
ok('"cove" finds the Hidden Cove listing', hits("cove").some(r=>r.ListingKey==="77777"));
ok('"cove" does not find Boulder Lake', !hits("cove").some(r=>r.ListingKey==="21463762"));
ok('"the cove" finds Hidden Cove', hits("the cove").some(r=>r.ListingKey==="77777"));

S("DEFECT 2 regression: multi-word searches");
for(const t of ["Vestavia Hills 35242","Boulder Lake Vestavia Hills","Liberty Park Vestavia",
                "Boulder Lake Circle Vestavia","4413 Boulder Lake Cir Vestavia Hills"]) {
  ok(`"${t}" finds Boulder Lake`, hits(t).some(r=>r.ListingKey==="21463762"), `hits=${hits(t).length}`);
}
ok('"Vestavia Hills 35242" excludes Fultondale', !hits("Vestavia Hills 35242").some(r=>r.ListingKey==="21463044"));
ok('"Hoover 35242" matches nothing (no such row)', hits("Hoover 35242").length===0);

S("DEFECT 11 regression: zip+4 and odd street numbers");
ok('"35242" matches the ZIP+4 row', hits("35242").some(r=>r.ListingKey==="88888"));
ok('"35242" matches the plain-zip row', hits("35242").some(r=>r.ListingKey==="21463762"));
ok('"35242" excludes 35068', !hits("35242").some(r=>r.ListingKey==="21463044"));

S("the original complaint");
for(const t of ["4413 Boulder Lake Cir","4413 Boulder Lake Circle","4413 boulder lake","Boulder Lake",
                "BOULDER","21463762","35242","Vestavia Hills","Liberty Park","liberty park vestavia",
                "4413 BOULDER LAKE CIR","  4413   Boulder   Lake  Cir  "]) {
  ok(`"${t}" finds her house`, hits(t).some(r=>r.ListingKey==="21463762"), `hits=${hits(t).length}`);
}

S("precision: wrong rows must be rejected");
ok('"4413 Boulder Lake" rejects the 4413 Oak Ridge decoy', !hits("4413 Boulder Lake").some(r=>r.ListingKey==="99999"));
ok('"Boulder Lake" rejects Fultonbrook', !hits("Boulder Lake").some(r=>r.ListingKey==="21463044"));
ok('"21463762" returns exactly one row', hits("21463762").length===1);
ok('"Fultondale" rejects Boulder Lake', !hits("Fultondale").some(r=>r.ListingKey==="21463762"));
ok('"zzzqqq" matches nothing', hits("zzzqqq").length===0);
ok('"asdfghjkl" matches nothing', hits("asdfghjkl").length===0);

S("junk input: never a full-market dump");
/* Genuinely empty input means "no search" and must not filter anything. */
for(const j of ["","   ","!!!"]) {
  const p=parseQuery(j);
  ok(`${JSON.stringify(j)} yields no tokens`, p.tokens.length===0, JSON.stringify(p.tokens));
  ok(`${JSON.stringify(j)} is a no-op`, rowMatchesText(BOULDER,p)===true);
}
/* Input that survives cleaning but matches nothing must return NOTHING —
   the old bug returned the entire market for exactly this case. */
for(const j of ["@#$%","---","###","zzz"]) {
  ok(`${JSON.stringify(j)} returns no rows, not the market`, hits(j).length===0, `hits=${hits(j).length}`);
}

S("property type");
const t=(row,k)=>rowMatchesType(row,k);
ok("single-family matches a house", t(BOULDER,"single-family"));
ok("single-family rejects a condo", !t(CONDO,"single-family"));
ok("single-family rejects a LEASE", !t(LEASE,"single-family"));
ok("DEFECT 10: townhome option matches a condo", t(CONDO,"townhome"));
ok("DEFECT 10: townhome option matches a townhouse", t(TOWN,"townhome"));
ok("townhome rejects a house", !t(BOULDER,"townhome"));
ok("lot matches unimproved land", t(LOT,"lot"));
ok("lot rejects a house", !t(BOULDER,"lot"));
ok("commercial matches retail", t(COMM,"commercial"));
ok("commercial rejects a house", !t(BOULDER,"commercial"));
ok("rental matches a lease", t(LEASE,"rental"));
ok("rental rejects a sale", !t(BOULDER,"rental"));

S("phrase candidates feed the MLS a question that can hit");
const c=phraseCandidates(["BOULDER","LAKE","VESTAVIA","HILLS"]);
ok("includes the full street name", c.includes("BOULDER LAKE"), c.join("|"));
ok("includes the full city name", c.includes("VESTAVIA HILLS"));
ok("includes single tokens", c.includes("BOULDER"));
ok("is capped", c.length<=12);

S("safety");
ok("apostrophe survives parsing", parseQuery("O'Brien Lane").needles.includes("BRIEN"));
ok("angle brackets are stripped", !parseQuery("<img src=x onerror=alert(1)>").upper.includes("<"));
ok("long input is capped at 80", parseQuery("A".repeat(500)).text.length<=80);
ok("sql-ish input is harmless", parseQuery("' OR 1=1--").upper.indexOf("'")===-1);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
