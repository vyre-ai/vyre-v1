// The fixtures cannot drift from the prototype: this runs the prototype's own seed code (cut out of scripts/shots/prototype/vyre-v1.html) and compares what it draws with the fixtures,
// and re-reads the extracted tables. If the prototype changes and prototype-data.ts is not regenerated (python3 scripts/shots/extract-fixtures.py), this fails.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { PROTO_CHN, PROTO_CHW, PROTO_CITIES, PROTO_FIRST, PROTO_HAND, PROTO_LAST, PROTO_NEXTS, PROTO_SPACE_TYPES, PROTO_STREETS, PROTO_TEAM } from "./prototype-data.ts";
import { PROTO_CLIENT_COUNT, pickChannel, protoClients, protoHash, protoWork } from "./prototype-clients.ts";

const FILE = fileURLToPath(new URL("../../../../scripts/shots/prototype/vyre-v1.html", import.meta.url));
const unescape = (s: string): string => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
const TEXT = unescape(fs.readFileSync(FILE, "utf8"));

/** The text from `from` up to (not including) `to`, searching on from `after`. */
function between(from: string, to: string, after = 0): string {
  const a = TEXT.indexOf(from, after);
  assert.ok(a >= 0, `prototype has ${from}`);
  const b = TEXT.indexOf(to, a);
  assert.ok(b > a, `prototype has ${to} after ${from}`);
  return TEXT.slice(a, b);
}

interface Drawn { name: string; status: string; owner: string; fit: number | null; since: string; source: string }
interface Ran { clients: Drawn[]; projects: Record<string, unknown>[]; invoices: Record<string, unknown>[]; meetings: Record<string, unknown>[]; tasks: Record<string, unknown>[] }

/** Run the prototype's whole seedData (clients, projects, invoices, meetings, tasks) and hand back D. */
function runPrototypeSeed(): Ran {
  const schema = TEXT.indexOf("/* ---------- schema ---------- */");
  const prelude = [
    between("const pad = ", "\n", schema - 4000), between("const TODAY = ", "\n", schema - 4000), between("const pd = ", "\n", schema - 4000),
    between("const isoD = ", "\n", schema - 4000), between("const isoDT = ", "\n", schema - 4000), between("const addDays = ", "\n", schema - 4000),
    between("const TEAM = ", "\n", schema),
  ].join("\n");
  const seed = TEXT.indexOf("function seedData()", schema);
  const mul = between("function mulberry32", "\n", schema);
  const consts = between("const FIRST = ", "function seedData()", schema);
  const end = TEXT.indexOf("for (const k in D) TY[k].rows = D[k];", seed);
  assert.ok(end > seed, "the prototype's seedData ends with the rows");
  const body = TEXT.slice(seed, end);
  const code = `${prelude}\n${mul}\n${consts}\nconst TY = { clients: {}, projects: {}, invoices: {}, meetings: {}, tasks: {} };\n${body}\n}\nseedData();\nD;`;
  return JSON.parse(JSON.stringify(vm.runInNewContext(code, {}))) as Ran;
}

function runPrototypeClients(): Drawn[] {
  const ran = runPrototypeSeed();
  // the one change later prototype code makes to these rows: the drawn "Oscar Pruitt" (else row 7) becomes Marcus Pruitt; its own line says so
  assert.match(between("const pr = D.clients.find", "pr.email", TEXT.indexOf("function seedData()")), /pr\.name = "Marcus Pruitt";/);
  const pr = ran.clients.find((r) => r.name === "Oscar Pruitt") ?? (ran.clients[6] as Drawn);
  pr.name = "Marcus Pruitt";
  return ran.clients.map((r) => ({ name: r["name"], status: r["status"], owner: r["owner"], fit: (r["fit"] as number | null) ?? null, since: r["since"], source: r["source"] }));
}

test("all 1,240 Northwind clients are what the prototype's own seed code draws", () => {
  const proto = runPrototypeClients();
  const ours = protoClients();
  assert.equal(proto.length, PROTO_CLIENT_COUNT);
  assert.equal(ours.length, PROTO_CLIENT_COUNT);
  for (let i = 0; i < proto.length; i++) {
    const o = ours[i]!;
    assert.deepEqual({ name: o.name, status: o.status, owner: o.owner, fit: o.fit, since: o.since, source: o.source }, proto[i], `client ${i}`);
  }
});

test("the first channel comes from the prototype's hash and channel picker", () => {
  const schema = TEXT.indexOf("/* ---------- schema ---------- */");
  const code = `${between("const hash = ", "\n", 0)}\n${between("const CHN = ", "\n", schema)}\n${between("const CHW = ", "\n", schema)}\n${between("const pickCh = ", "\n", schema)}\n({ hash, pickCh })`;
  const proto = vm.runInNewContext(code, {}) as { hash: (s: string) => number; pickCh: (u: number) => string };
  for (const s of ["c1a", "c2b", "c1239c", "x", "Northwind"]) assert.equal(protoHash(s), proto.hash(s), s);
  for (let i = 0; i <= 100; i++) assert.equal(pickChannel(i / 100), proto.pickCh(i / 100), String(i));
  const ours = protoClients();
  for (let i = 1; i < 60; i++) assert.equal(ours[i]!.fch, proto.pickCh((proto.hash(`c${i}a`) % 1000) / 1000), `c${i}`);
  assert.equal(ours[0]!.fch, "Referral");
});

test("the extracted tables are the prototype's", () => {
  const num = (name: string): unknown[] => JSON.parse(JSON.stringify(vm.runInNewContext(`(${between(`const ${name} = `, ";\n", TEXT.indexOf("function seedData()") - 30000).slice(`const ${name} = `.length)})`, {}))) as unknown[];
  assert.deepEqual(PROTO_FIRST, num("FIRST"));
  assert.deepEqual(PROTO_LAST, num("LAST"));
  assert.deepEqual(PROTO_STREETS, num("STREETS"));
  assert.deepEqual(PROTO_CITIES, num("CITIES"));
  assert.deepEqual(PROTO_NEXTS, num("NEXTS"));
  assert.equal(PROTO_HAND.length, 6);
  assert.deepEqual(PROTO_TEAM, ["Maya Chen", "Omar Haddad", "Lena Ortiz", "Sam Patel"]);
  assert.equal(PROTO_CHN.length, PROTO_CHW.length);
});

test("Harbor Studio and Personal rows are the prototype's seedSpaces rows", () => {
  const block = between("(function seedSpaces()", "/* the signed-in person's grants");
  for (const [tid, def] of Object.entries(PROTO_SPACE_TYPES)) {
    assert.ok(block.includes(`mk("${tid}"`), tid);
    for (const row of def.rows) for (const v of Object.values(row)) if (typeof v === "string" && v !== "") assert.ok(block.includes(v), `${tid}: ${v}`);
    for (const f of def.fields) assert.ok(block.includes(`F("${f.id}", "${f.name}"`), `${tid}.${f.id}`);
  }
  assert.deepEqual(PROTO_SPACE_TYPES["hclients"]?.rows.map((r) => r["name"]), ["Kestrel Coffee", "Tidewater Books", "Alder Pottery"]);
  assert.deepEqual(PROTO_SPACE_TYPES["hjobs"]?.rows.map((r) => r["title"]), ["Menu redesign", "Shop front signage", "Launch poster set"]);
});

/** The text of the bracketed literal that opens at `start`, strings and template strings respected. */
function balancedAt(src: string, start: number): string {
  let depth = 0, i = start, q: string | null = null;
  for (;; i++) {
    const c = src[i] as string;
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
}

test("the chat seed of all three Spaces is what the prototype's own seed and seedFor draw, flags included", async () => {
  const { PROTO_CHAT } = await import("./prototype-chat.ts");
  const i = TEXT.indexOf('  const seed = () => ({\n    space: "nw"');
  assert.ok(i > 0, "the prototype has the chat seed");
  const lit = balancedAt(TEXT, TEXT.indexOf("({", i));
  const f = TEXT.indexOf("  function seedFor(sp) {", i);
  const end = TEXT.indexOf("\n  }\n", f) + 4;
  const code = `const SPID = { team: "nw", personal: "me", harbor: "hb" };\nconst seed = () => ${lit};\n${TEXT.slice(f, end)}\n({ nw: seedFor("team"), hb: seedFor("harbor"), me: seedFor("personal") })`;
  const ran = JSON.parse(JSON.stringify(vm.runInNewContext(code, { window: {} })));
  // the prototype sets b.space to the Space's short id; so does the extractor
  assert.deepEqual(PROTO_CHAT, ran);
  const ch = (PROTO_CHAT["nw"] as { channels: { n: string; project?: boolean; followed?: boolean; starred?: boolean }[] }).channels;
  assert.deepEqual(ch.map((c) => [c.n, c.project === true, c.followed === true, c.starred === true]), [["intake", false, false, false], ["billing", false, false, false], ["pruitt-matter", true, true, false], ["atp-q4", true, false, false], ["rivera-matter", false, false, false]], "the followed project channel is the one the sidebar shows");
  assert.equal((PROTO_CHAT["nw"] as { needs: unknown[] }).needs.length, 8);
  assert.equal((PROTO_CHAT["hb"] as { needs: unknown[] }).needs.length, 2);
  assert.equal((PROTO_CHAT["me"] as { chats: unknown[] }).chats.length, 3);
});

test("the projects, invoices, meetings and tasks are what the prototype's own seedData draws, all of them", () => {
  const ran = runPrototypeSeed();
  const w = protoWork();
  const pick = (rows: Record<string, unknown>[], keys: string[]): Record<string, unknown>[] => rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));
  const one = (v: unknown): unknown => (Array.isArray(v) ? (v[0] ?? null) : v);
  assert.equal(w.projects.length, 380);
  assert.equal(w.invoices.length, 2120);
  assert.equal(w.meetings.length, 650);
  assert.equal(w.tasks.length, 920);
  assert.deepEqual(w.projects.map((p) => ({ ...p })), pick(ran.projects, ["id", "title", "stage", "lead", "start", "due", "budget", "tags"]).map((r, i) => ({ id: r["id"], title: r["title"], client: one((ran.projects[i] as Record<string, unknown>)["client"]), stage: r["stage"], lead: r["lead"], start: r["start"], due: r["due"], budget: r["budget"], tags: r["tags"] })));
  assert.deepEqual(w.invoices.map((x) => ({ ...x })), ran.invoices.map((r) => ({ id: r["id"], no: r["no"], client: one(r["client"]), project: one(r["project"]), amount: r["amount"], status: r["status"], issued: r["issued"], due: r["due"], method: r["method"] })));
  assert.deepEqual(w.meetings.map((x) => ({ ...x })), ran.meetings.map((r) => ({ id: r["id"], title: r["title"], when: r["when"], client: one(r["client"]), host: r["host"], kind: r["kind"], done: r["done"], notes: r["notes"] })));
  assert.deepEqual(w.tasks.map((x) => ({ ...x })), ran.tasks.map((r) => ({ id: r["id"], title: r["title"], project: one(r["project"]), assignee: r["assignee"], status: r["status"], due: r["due"], done: r["done"] })));
});
