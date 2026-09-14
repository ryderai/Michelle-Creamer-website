/* Re-extracts the pure functions from api/listings.js so the logic tests run
   against the real source instead of a stale copy. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '../api/listings.js'), 'utf8');
const grab = (a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i)); };
const parts = [
  "const q = (s) => `'${String(s).replace(/'/g, \"''\")}'`;\n",
  grab('const STREET_SUFFIXES', 'function rowText(row)'),
  grab('function rowText(row)', '/* The MLS-side half'),
  grab('function rowMatchesText(row, parsed)', 'const SORTS'),
  grab('const TYPE_MATCH = {', 'async function typeClause')
];
fs.writeFileSync(path.resolve(here, '_extracted-logic.mjs'),
  parts.join('\n') + "\nexport { parseQuery, phraseCandidates, rowText, rowMatchesText, rowMatchesType, TYPE_MATCH };\n");
console.log('regenerated _tests/_extracted-logic.mjs');
