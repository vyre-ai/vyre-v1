// Runs the pieces of the prototype that are code, not data, in a node vm and prints what they build as JSON: the inbox (its inboxes, the contacts with every message, the templates, the snippets) and the
// Journeys. The prototype writes these with its own helpers and with variables and expressions (TH.slice(), JC, mail(...)), so extract-fixtures.py reads them from here instead of parsing JS.
// apps/app/src/fixtures/prototype-source.test.ts cuts the same text the same way and compares, so the two cannot disagree.
// CLI: node scripts/shots/extract-vm.mjs   (used by extract-fixtures.py; never run on the Mac)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.join(HERE, "prototype", "vyre-v1.html");
const unescape = (s) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");

/** The text from `from` up to (not including) `to`, searching on from `after`. */
function between(text, from, to, after = 0) {
  const a = text.indexOf(from, after);
  if (a < 0) throw new Error(`the prototype has no ${from}`);
  const b = text.indexOf(to, a);
  if (b <= a) throw new Error(`the prototype has no ${to} after ${from}`);
  return text.slice(a, b);
}
/** The text of the bracketed literal that opens at `start`, strings and template strings respected. */
function balancedAt(src, start) {
  let depth = 0, i = start, q = null;
  for (;; i++) {
    const c = src[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
}
const run = (code) => JSON.parse(JSON.stringify(vm.runInNewContext(code, {})));

export function extract() {
  const text = unescape(fs.readFileSync(PROTO, "utf8"));
  const inboxes = between(text, "const INBOXES = [", "const byId0", 0);
  const a = run(`${inboxes}\n({ INBOXES, CONTACTS });`);
  const tail = between(text, "const TEMPLATES = [", "/* ---------- state ---------- */", text.indexOf("const INBOXES = ["));
  const b = run(`${tail}\n({ TEMPLATES, SNIPPETS });`);
  const j = text.indexOf("const JOURNEYS = [");
  const literal = balancedAt(text, text.indexOf("[", j));
  const mtLine = between(text, "const mt = ", "\n", j - 3000);
  const c = run(`let uidN = 100; const uid = (p) => (p || "x") + ++uidN;\n${mtLine}\nconst JOURNEYS = ${literal};\nJOURNEYS;`);
  return { INBOXES: a.INBOXES, CONTACTS: a.CONTACTS, TEMPLATES: b.TEMPLATES, SNIPPETS: b.SNIPPETS, JOURNEYS: c };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(extract()));
