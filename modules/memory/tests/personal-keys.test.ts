// A person's private memory under their own key (owner ruling 3 Nov 2026, spec b7, modules/memory/personal.ts). The keyring is a stand-in that holds Dana's person key while "she is signed in".
//   - her own turn with the key held writes under her own key, recalls it and finds it in search;
//   - with the key gone, capture still writes (to her public key), and her recall and search come back empty with one plain line saying why; the key back, it all opens;
//   - at rest, the database and every server key in the test cannot open her rows;
//   - rows from before (the server seal) are re-sealed by the background job once her key is held, verified, and the old values are gone; a person never signed in keeps the old seal;
//   - what capture wrote twice while she was out is folded; a sign-out drops her in-memory index.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { capture, factsList, pointer, proposeFact, search } from "../handlers/facts.ts";
import { pageGet, pagePut } from "../handlers/pages.ts";
import { createCtxSeal } from "../../../host/src/ctx/seal.ts";
import { PersonMemoryKey } from "../../../kernel/src/seal/index.ts";
import { LOCKED_LINE, indexedPeople, setMemoryKeyPort, sweepHeld } from "../personal.ts";
import { settlePersonal } from "../settle.ts";
import { asPerson, contractErrors, harness, seedFact } from "../fixtures/harness.ts";
import type { Harness, Responder } from "../fixtures/harness.ts";

const DANA_KEY = crypto.randomBytes(32);
const SARA_KEY = crypto.randomBytes(32);
/** The keyring stand-in: who is signed in here with their key handed over. */
const held = new Map<string, Uint8Array>();
let wipes = 0;
setMemoryKeyPort({ personKey: (p) => (held.has(p) ? Uint8Array.from(held.get(p)!) : null), wipe: (fn) => { wipes++; return fn(); } });
test.after(() => setMemoryKeyPort(null));
const signIn = (p: string, k: Uint8Array): void => { held.set(p, k); };
const signOut = (p: string): void => { held.delete(p); };

const dana = () => harness();
/** A new call as this person on the same database: the host makes a ctx per call, so a sign-in or sign-out is seen by the next one. */
const as = (h: Harness, id = "usr_dana") => asPerson(h, { kind: "person", id });
const service = (h: Harness, respond: Record<string, Responder> = {}) => harness({ raw: h.raw, clock: h.clock, principal: { kind: "service", id: "svc_engine" }, respond });
const sealedOf = (h: Harness, id: string): string => String(h.rows("SELECT sealed FROM memory_facts WHERE id = ?", id)[0]?.["sealed"] ?? "");
const say = (h: Harness, text: string) => proposeFact(h.ctx, { text, agentId: "agt_intake", sourceKind: "manual", sourceRef: "typed" });

function chatOf(body: string): Record<string, Responder> {
  return {
    "threads.get": () => ({ thread: { kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" }], members: [{ kind: "person", id: "usr_dana" }] } }),
    "chat.messages.list": () => ({ messages: [{ messageId: `msg_${crypto.randomBytes(4).toString("hex")}`, author: { kind: "person", id: "usr_dana" }, body }] }),
  };
}

test("her own turn with her key held: sealed under her own key, recalled and found", async () => {
  signIn("usr_dana", DANA_KEY);
  const h = dana();
  const out = await say(h, "Dana takes her coffee black with cardamom");
  assert.equal(out.fact.text, "Dana takes her coffee black with cardamom");
  assert.match(sealedOf(h, out.fact.factId), /^pm1\.o\./, "the own form: her row key, made from her person key");
  assert.equal(h.rows("SELECT text FROM memory_facts WHERE id = ?", out.fact.factId)[0]?.["text"], "");
  const p = await pointer(h.ctx, { threadId: "thr_a", agentId: "agt_intake", text: "how does Dana take her coffee?" });
  assert.equal(p.lines[0]?.fact, "Dana takes her coffee black with cardamom");
  assert.equal(p.locked, undefined);
  const s = await search(h.ctx, { q: "cardamom coffee", mode: "keyword" });
  assert.equal(s.hits[0]?.factId, out.fact.factId);
  assert.equal(s.locked, undefined);
  // her public key is registered for the writes made while she is out; only the public half
  const keys = h.rows("SELECT public_key, key_tag FROM memory_person_keys WHERE owner_ref = 'usr_dana'");
  assert.equal(keys.length, 1);
  assert.equal(keys[0]!["public_key"], PersonMemoryKey.from(DANA_KEY).pub);
  // another person cannot read it, even while Dana's key is held
  const omar = asPerson(h, { kind: "person", id: "usr_omar" });
  assert.equal((await search(omar.ctx, { q: "cardamom coffee", mode: "keyword" })).hits.length, 0);
  assert.equal((await factsList(omar.ctx, { layer: "person" })).facts.length, 0);
  signOut("usr_dana");
});

test("signed out: capture still writes to her public key; her recall is empty with a plain line; signed in again, it opens", async () => {
  signIn("usr_dana", DANA_KEY);
  const h = dana();
  await say(h, "Dana's daughter is called Zara");   // registers her key here
  signOut("usr_dana");
  // the chat closes while she is signed out: capture runs as the engine and writes her facts without any private key
  const svc = service(h, chatOf("I prefer meetings after 2pm. My timezone is Karachi."));
  const got = await capture(svc.ctx, { threadId: "thr_out", reason: "closed" });
  assert.ok(got.proposed >= 2, JSON.stringify(got));
  const rows = h.rows("SELECT id, sealed FROM memory_facts WHERE layer = 'person' AND source_ref = 'thr_out'");
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.match(String(r["sealed"]), /^pm1\.p\./, "sealed to her public key");
  // her own reads now: nothing personal, and the reason
  const out1 = as(h);
  const p = await pointer(out1.ctx, { threadId: "thr_b", agentId: "agt_intake", text: "when does Dana prefer meetings, and what is her daughter called?" });
  assert.deepEqual(p.lines, []);
  assert.equal(p.locked, LOCKED_LINE);
  assert.deepEqual(contractErrors("memory.pointer", "out", p), []);
  const s = await search(out1.ctx, { q: "meetings after 2pm", mode: "keyword" });
  assert.equal(s.hits.length, 0);
  assert.equal(s.locked, LOCKED_LINE);
  assert.deepEqual(contractErrors("memory.search", "out", s), []);
  const list = await factsList(out1.ctx, { layer: "person", status: ["current", "proposed"] });
  assert.equal(list.facts.length, 0, "no empty rows stand in for what cannot be opened");
  assert.equal(list.locked, LOCKED_LINE);
  // signed in again: everything opens, the offline write included
  signIn("usr_dana", DANA_KEY);
  const back = as(h);
  const again = await search(back.ctx, { q: "meetings after 2pm", mode: "keyword" });
  assert.equal(again.locked, undefined);
  assert.ok(again.hits.some((x) => x.text.includes("meetings after 2pm")), JSON.stringify(again.hits));
  const p2 = await pointer(back.ctx, { threadId: "thr_c", agentId: "agt_intake", text: "what is Dana's daughter called?" });
  assert.equal(p2.lines[0]?.fact, "Dana's daughter is called Zara");
  signOut("usr_dana");
});

test("at rest: the database and the server's keys cannot open her memory", async () => {
  signIn("usr_dana", DANA_KEY);
  const h = dana();
  const secret = "Dana's bank PIN hint is the year of the Lahore flood";
  await say(h, secret);
  await pagePut(h.ctx, { title: "Dana's health", layer: "person", agentId: "agt_intake", notes: "Allergic to penicillin. Sees Dr Shah on Tuesdays." });
  signOut("usr_dana");
  const svc = service(h, chatOf("Remember that my passport expires in March."));
  await capture(svc.ctx, { threadId: "thr_rest", reason: "closed" });
  settlePersonal(svc.ctx);   // nobody's key is held: nothing moves

  // everything the database holds for memory
  const tables = (h.raw.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'memory_%'") as Array<{ name: string }>).map((t) => t.name);
  const dump = JSON.stringify(tables.map((t) => h.raw.all(`SELECT * FROM ${t}`)));
  for (const words of [secret, "penicillin", "Dr Shah", "passport expires", "Dana's health"]) assert.ok(!dump.includes(words), `"${words}" is in the database in the clear`);
  // every sealed personal value, and every key the server has: its seal key, the key the old scheme derived from it, and the public half of Dana's pair
  const values = [
    ...h.raw.all("SELECT sealed AS v FROM memory_facts WHERE layer = 'person'"), ...h.raw.all("SELECT sealed AS v FROM memory_pages WHERE layer = 'person'"),
    ...h.raw.all("SELECT sealed AS v FROM memory_page_versions WHERE sealed IS NOT NULL"),
  ].map((r) => String((r as { v: unknown }).v));
  assert.ok(values.length >= 4);
  const serverSeal = "memory-test-seal-key-0123456789abcdef";
  const pub = String((h.raw.all("SELECT public_key FROM memory_person_keys WHERE owner_ref = 'usr_dana'")[0] as { public_key: string }).public_key);
  const candidates: Uint8Array[] = [
    Buffer.from(serverSeal).subarray(0, 32), new Uint8Array(crypto.hkdfSync("sha256", Buffer.from(serverSeal), "vyre/ctx.seal/v1", "scope:mem.usr_dana", 32)), Buffer.from(pub, "base64url"),
  ];
  const seal = createCtxSeal({ key: serverSeal, keyId: "k1" });
  for (const v of values) {
    assert.match(v, /^pm1\.[op]\./, "under her own key, not the server's");
    assert.throws(() => seal.unseal(JSON.parse(v)), "not a server-sealed value");
    for (const k of candidates) assert.throws(() => PersonMemoryKey.from(k).open(v, "vyre:memory:v1|usr_dana"), "a server key does not open it");
    // her key does
    assert.ok(PersonMemoryKey.from(DANA_KEY).open(v, "vyre:memory:v1|usr_dana").length > 0);
  }
  // the server process itself, asked as Dana with her key not held, reads nothing
  const page = await pageGet(as(h).ctx, { title: "Dana's health" }).catch(() => null);
  assert.ok(page === null || page.notes === "", "her page does not open without her key");
});

test("migration: rows under the old server seal are re-sealed to her key once it is held, verified, and the old values are gone; a person never signed in keeps theirs", async () => {
  const h = dana();
  // before this release: no key ever held here, so writes take the server seal (scope mem.<owner>)
  seedFact(h, { id: "fct_old1", layer: "person", agentId: "agt_intake", text: "Dana's old fact: she lives in Karachi" });
  seedFact(h, { id: "fct_old2", layer: "person", agentId: "agt_intake", text: "Dana's old fact: she likes green tea" });
  seedFact(h, { id: "fct_sara", layer: "person", owner: "usr_sara", agentId: "agt_intake", text: "Sara's fact: she runs on Sundays" });
  await pagePut(h.ctx, { title: "Dana's trips", layer: "person", agentId: "agt_intake", notes: "Skardu in June. [[Hunza]] next." });
  const before = new Map(h.rows("SELECT id, sealed FROM memory_facts").map((r) => [String(r["id"]), String(r["sealed"])]));
  for (const v of before.values()) assert.match(v, /^\{/, "the old server seal");
  const oldPage = String(h.rows("SELECT sealed FROM memory_pages")[0]?.["sealed"]);

  // nobody signed in: the job moves nothing
  const svc = service(h);
  assert.equal(settlePersonal(svc.ctx).resealed, 0);

  // Dana signs in: the next pass re-seals all of hers
  signIn("usr_dana", DANA_KEY);
  const w0 = wipes;
  const out = settlePersonal(service(h).ctx);
  assert.equal(out.people, 1);
  assert.ok(out.resealed >= 4, JSON.stringify(out));
  assert.equal(out.unreadable, 0);
  assert.ok(wipes > w0, "the old values were overwritten with secure_delete on");
  for (const id of ["fct_old1", "fct_old2"]) assert.match(sealedOf(h, id), /^pm1\.o\./);
  assert.match(String(h.rows("SELECT sealed FROM memory_pages")[0]?.["sealed"]), /^pm1\.o\./);
  for (const r of h.rows("SELECT sealed FROM memory_page_versions")) assert.match(String(r["sealed"]), /^pm1\.o\./);
  // no copy of an old value is left in any memory table
  const dump = JSON.stringify((h.raw.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'memory_%'") as Array<{ name: string }>).map((t) => h.raw.all(`SELECT * FROM ${t.name}`)));
  assert.ok(!dump.includes(before.get("fct_old1")!) && !dump.includes(oldPage), "the old sealed values are gone");
  // the same words, now under her key
  const now = as(h);
  const list = await factsList(now.ctx, { layer: "person" });
  assert.deepEqual(list.facts.map((f) => f.text).sort(), ["Dana's old fact: she likes green tea", "Dana's old fact: she lives in Karachi"]);
  assert.equal((await pageGet(now.ctx, { title: "Dana's trips" })).notes, "Skardu in June. [[Hunza]] next.");
  // Sara never signed in: hers keeps the old seal and still opens for her
  assert.equal(sealedOf(h, "fct_sara"), before.get("fct_sara"));
  const sara = asPerson(h, { kind: "person", id: "usr_sara" });
  assert.equal((await factsList(sara.ctx, { layer: "person" })).facts[0]?.text, "Sara's fact: she runs on Sundays");
  // a second pass has nothing left to do
  assert.equal(settlePersonal(service(h).ctx).resealed, 0);
  signOut("usr_dana");
});

test("what capture wrote twice while she was out is folded when she is back; a sign-out drops her in-memory index", async () => {
  signIn("usr_dana", DANA_KEY);
  const h = dana();
  await say(h, "I prefer tea over coffee.");
  signOut("usr_dana");
  // with no key, capture cannot see the fact that is already there, so it writes it again
  await capture(service(h, chatOf("I prefer tea over coffee.")).ctx, { threadId: "thr_dup", reason: "closed" });
  assert.equal(h.rows("SELECT id FROM memory_facts WHERE layer = 'person' AND status IN ('current', 'proposed')").length, 2);
  signIn("usr_dana", DANA_KEY);
  const out = settlePersonal(service(h).ctx);
  assert.equal(out.folded, 1);
  const live = await factsList(as(h).ctx, { layer: "person", status: ["current", "proposed"] });
  assert.deepEqual(live.facts.map((f) => f.text), ["I prefer tea over coffee."]);
  assert.ok(indexedPeople() >= 1, "her index is warm");
  signOut("usr_dana");
  sweepHeld();
  assert.equal(indexedPeople(), 0, "signed out: nothing personal stays in memory");
});

test("a reset person key: rows under the old key stay closed, new ones use the new key", async () => {
  signIn("usr_sara", SARA_KEY);
  const h = harness({ principal: { kind: "person", id: "usr_sara" } });
  await say(h, "Sara's fact under her first key");
  const fresh = crypto.randomBytes(32);
  signIn("usr_sara", fresh);
  const later = as(h, "usr_sara");
  await say(later, "Sara's fact under her new key");
  const texts = (await factsList(later.ctx, { layer: "person" })).facts.map((f) => f.text);
  assert.deepEqual(texts, ["Sara's fact under her new key"]);
  assert.equal(String(h.rows("SELECT public_key FROM memory_person_keys WHERE owner_ref = 'usr_sara'")[0]?.["public_key"]), PersonMemoryKey.from(fresh).pub);
  const out = settlePersonal(service(h).ctx);
  assert.equal(out.unreadable, 1, "the job cannot move a row it cannot open, and says so");
  signOut("usr_sara");
});

test("a person-layer fact made plain on purpose (her public profile, lane l-profile: enc 0, sealed NULL) is skipped by the job and still recalled", async () => {
  signIn("usr_dana", DANA_KEY);
  const h = dana();
  const pub = await say(h, "Dana is the firm's estate planning lead");
  const priv = await say(h, "Dana is training for the Lahore marathon");
  // what the profile lane does when she moves it to her public profile
  h.db.run("UPDATE memory_facts SET enc = 0, sealed = NULL, text = ? WHERE id = ?", "Dana is the firm's estate planning lead", pub.fact.factId);
  const out = settlePersonal(service(h).ctx);
  assert.equal(out.unreadable, 0, "the plain row is not taken for a sealed one");
  const row = h.rows("SELECT enc, sealed, text FROM memory_facts WHERE id = ?", pub.fact.factId)[0]!;
  assert.deepEqual([row["enc"], row["sealed"], row["text"]], [0, null, "Dana is the firm's estate planning lead"], "left plain");
  assert.match(sealedOf(h, priv.fact.factId), /^pm1\.o\./);
  const v = as(h);
  const p = await pointer(v.ctx, { threadId: "thr_pub", agentId: "agt_intake", text: "who is the estate planning lead?" });
  assert.equal(p.lines[0]?.fact, "Dana is the firm's estate planning lead");
  const m = await pointer(v.ctx, { threadId: "thr_pub2", agentId: "agt_intake", text: "what is Dana training for?" });
  assert.equal(m.lines[0]?.fact, "Dana is training for the Lahore marathon");
  signOut("usr_dana");
});
