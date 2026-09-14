/* A stand-in for Greater Alabama MLS that behaves like the real one:
   it answers HTTP 500 to any $filter containing contains( or startswith(,
   which is the measured behaviour that caused the bug. */
export function makeFakeMls(rows, { supportsContains = false, failEverything = false } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, opts) => {
      const u = String(url);
      if (u.includes("/identity/connect/token")) {
        return { ok: true, status: 200, json: async () => ({ access_token: "T", expires_in: 3600 }) };
      }
      calls.push(u);
      if (failEverything) {
        return { ok: false, status: 500, text: async () => '{"error":{"code":500}}' };
      }
      const qs = new URL(u).searchParams;
      const filter = qs.get("$filter") || "";
      if (!supportsContains && /contains\(|startswith\(/.test(filter)) {
        return { ok: false, status: 500, text: async () => '{"error":{"code":500}}' };
      }
      if (u.includes("OpenHouse?")) {
        return { ok: true, status: 200, json: async () => ({ value: [] }) };
      }
      let out = rows.filter(r => evalFilter(filter, r));
      const orderby = qs.get("$orderby");
      if (orderby) {
        const [f, dir] = orderby.split(" ");
        out = out.slice().sort((a, b) => {
          const x = a[f], y = b[f];
          const c = x === y ? 0 : (x > y ? 1 : -1);
          return dir === "desc" ? -c : c;
        });
      }
      const skip = Number(qs.get("$skip") || 0);
      const top  = Number(qs.get("$top") || 50);
      const body = { value: out.slice(skip, skip + top) };
      if (qs.get("$count") === "true") body["@odata.count"] = out.length;
      return { ok: true, status: 200, json: async () => body };
    }
  };
}

/* Tiny OData $filter evaluator — enough for eq / ne / ge / le / and / or /
   parentheses / contains / startswith. */
function evalFilter(filter, row) {
  if (!filter) return true;
  const js = tokenize(filter).map(t => {
    if (t === "and") return "&&";
    if (t === "or")  return "||";
    if (t === "(" || t === ")") return t;
    const m = t.match(/^(\w+)\s+(eq|ne|ge|le|gt|lt)\s+(.+)$/);
    if (m) {
      const [, field, op, rawVal] = m;
      const val = rawVal.startsWith("'") ? rawVal.slice(1, -1).replace(/''/g, "'") : Number(rawVal);
      const cur = row[field];
      const cmp = { eq: "===", ne: "!==", ge: ">=", le: "<=", gt: ">", lt: "<" }[op];
      if (rawVal === "true" || rawVal === "false") return `(${JSON.stringify(!!cur)} ${cmp} ${rawVal})`;
      if (typeof val === "number") return `(${Number(cur)} ${cmp} ${val})`;
      return `(${JSON.stringify(String(cur ?? ""))} ${cmp} ${JSON.stringify(String(val))})`;
    }
    const c = t.match(/^(contains|startswith)\((\w+),'(.*)'\)$/);
    if (c) {
      const [, fn, field, needle] = c;
      const cur = String(row[field] ?? "");
      return fn === "contains" ? JSON.stringify(cur.includes(needle)) : JSON.stringify(cur.startsWith(needle));
    }
    return "true";
  }).join(" ");
  try { return Function('"use strict";return (' + js + ')')(); } catch { return false; }
}

function tokenize(f) {
  const out = []; let buf = ""; let inStr = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === "'") { inStr = !inStr; buf += ch; continue; }
    if (!inStr && (ch === "(" || ch === ")")) {
      // keep function calls intact
      if (ch === "(" && /(contains|startswith)$/.test(buf.trim())) {
        let depth = 1, j = i + 1, s2 = false;
        while (j < f.length && depth) {
          if (f[j] === "'") s2 = !s2;
          else if (!s2 && f[j] === "(") depth++;
          else if (!s2 && f[j] === ")") depth--;
          j++;
        }
        buf += f.slice(i, j); i = j - 1; continue;
      }
      if (buf.trim()) out.push(buf.trim());
      out.push(ch); buf = ""; continue;
    }
    if (!inStr && f.slice(i, i + 5) === " and ") { if (buf.trim()) out.push(buf.trim()); out.push("and"); buf = ""; i += 4; continue; }
    if (!inStr && f.slice(i, i + 4) === " or ")  { if (buf.trim()) out.push(buf.trim()); out.push("or");  buf = ""; i += 3; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
