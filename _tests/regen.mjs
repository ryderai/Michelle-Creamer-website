/* Re-extracts the pure functions from api/listings.js so the logic tests run
   against the real source instead of a stale copy. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '../api/listings.js'), 'utf8');
const grab = (a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i)); };
/* Verifies every export actually made it across. An earlier version anchored on
   STREET_SUFFIXES and silently dropped NOISE_WORDS, which blew up at run time
   instead of failing here with a clear message. */
const parts = [
  "const q = (s) => `'${String(s).replace(/'/g, \"''\")}'`;\n",
  grab('const NOISE_WORDS', 'function rowText(row)'),
  grab('function rowText(row)', '/* The MLS-side half'),
  grab('function rowMatchesText(row, parsed)', 'const SORTS'),
  grab('const TYPE_MATCH = {', 'async function typeClause')
];

fs.writeFileSync(path.resolve(here, '_extracted-logic.mjs'),
  parts.join('\n') + "\nexport { parseQuery, phraseCandidates, rowText, rowMatchesText, rowMatchesType, TYPE_MATCH };\n");
const out = parts.join('\n') + "\nexport { parseQuery, phraseCandidates, rowText, rowMatchesText, rowMatchesType, TYPE_MATCH };\n";
for (const need of ['NOISE_WORDS', 'STREET_SUFFIXES', 'function parseQuery', 'function rowMatchesText',
                    'function rowMatchesType', 'const TYPE_MATCH', 'function phraseCandidates']) {
  if (!out.includes(need)) {
    console.error('regen FAILED: ' + need + ' was not extracted - fix the anchors in regen.mjs');
    process.exit(1);
  }
}
console.log('regenerated _tests/_extracted-logic.mjs');
