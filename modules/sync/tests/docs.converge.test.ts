// @reads /modules/sync/migrations/0001_pull.sql
// P-L1_06, plain documents (ARCH 5.6): three clients (one offline for a long stretch, one an agent actor) edit the same document and converge; the server's store rebuilds the same text; the Markdown snapshot
// is what search and agents read; a device restarted offline keeps its edits and merges them when the socket returns.
import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { BODY, CONTENT, baseSnapshot, buildDoc, fromB64, headSeq, memoryDocStore, toMarkdown, updatesAfter, versions } from "../docs/index.ts";
import { ADA, AGENT, BO, ctx, docRig } from "./docs.rig.test.ts";
import { createDocHandlers } from "../handlers/docs.ts";

const DOC = "not_conv";
const OWNER = { entity: "note", id: "n_conv" };

test("3 clients (one offline, one agent actor) converge; the server store rebuilds the same text; the Markdown snapshot matches", async () => {
  const rig = docRig();
  rig.allow(DOC, [ADA, BO, AGENT], { owner: OWNER });
  const a = rig.device(ADA), b = rig.device(BO), g = rig.device(AGENT);
  const dA = a.client.open(DOC), dB = b.client.open(DOC), dG = g.client.open(DOC);
  dA.text().insert(0, "# Plan\n\nstart\n");
  await rig.settle();
  assert.equal(dB.text().toString(), dA.text().toString());
  assert.equal(dG.text().toString(), dA.text().toString());

  b.down();
  // Deterministic edits: B (offline, 40 of them), A and the agent (online).
  let seed = 7;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const put = (d: typeof dA, tag: string, i: number): void => {
    const t = d.text();
    t.insert(Math.floor(rnd() * (t.length + 1)), `[${tag}${i}]`);
  };
  for (let i = 0; i < 40; i++) {
    put(dB, "b", i);
    put(dA, "a", i);
    put(dG, "g", i);
    if (i % 5 === 0) await rig.settle();
  }
  dA.text().delete(dA.text().toString().indexOf("start"), 5);
  await rig.settle();
  assert.notEqual(dB.text().toString(), dA.text().toString(), "B is behind while it is offline");
  assert.equal(dB.dirty(), true);

  b.up();
  await rig.settle();
  const text = dA.text().toString();
  assert.equal(dB.text().toString(), text);
  assert.equal(dG.text().toString(), text);
  for (const tag of ["a0", "a39", "b0", "b39", "g0", "g39"]) assert.ok(text.includes(`[${tag}]`), `${tag} survived the merge`);
  assert.ok(!text.includes("start"), "A's concurrent delete holds");
  assert.equal(dB.dirty(), false);
  assert.deepEqual(rig.errors, []);

  // Who wrote what is kept with each update.
  const actors = new Set(rig.server.attribution(ADA, DOC, "t").map((x) => x.actor));
  assert.deepEqual([...actors].sort(), [ADA, AGENT, BO].sort());

  // The server's store alone rebuilds the same text, and the open call hands a new device the same.
  assert.equal(buildDoc(rig.s.host.tx, DOC).getText(BODY).toString(), text);
  const open = rig.server.open(ADA, { doc: DOC }, "t");
  assert.equal(open.md, text);
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, fromB64(open.snapshot ?? ""));
  assert.equal(fresh.getText(BODY).toString(), text);

  // Compaction: one snapshot with the Markdown projection, the folded updates gone, the owning row's text written.
  const before = headSeq(rig.s.host.tx, DOC);
  const handlers = createDocHandlers(rig.server);
  const res = await handlers["sync.doc.compact"](ctx(ADA), { doc: DOC });
  assert.equal(res.upto, before);
  assert.ok(res.bytes > 0);
  const snap = baseSnapshot(rig.s.host.tx, DOC);
  assert.equal(snap?.md, text);
  assert.equal(snap?.upto, before);
  assert.equal(updatesAfter(rig.s.host.tx, DOC, 0).length, 0);
  assert.deepEqual(rig.projected.at(-1), { owner: OWNER, md: text, doc: DOC });
  assert.equal(rig.events.filter((e) => e.type === "doc.compacted").length, 1);

  // A device that joins after the fold still gets everything, and the next update takes a new seq.
  const c = rig.device(BO, { id: "dev_late" });
  const dC = c.client.open(DOC);
  await rig.settle();
  assert.equal(dC.text().toString(), text);
  dC.text().insert(0, "late ");
  await rig.settle();
  assert.ok(updatesAfter(rig.s.host.tx, DOC, 0)[0]!.seq > before);
  assert.equal(dA.text().toString(), `late ${text}`);
});

test("the Markdown projection reads the rich editor tree when the plain text is empty", () => {
  const y = new Y.Doc();
  y.getText(BODY);
  const f = y.getXmlFragment(CONTENT);
  const h = new Y.XmlElement("heading");
  h.setAttribute("level", "2");
  h.insert(0, [new Y.XmlText("Plan")]);
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [new Y.XmlText("Call the client.")]);
  const li = new Y.XmlElement("listItem");
  const lp = new Y.XmlElement("paragraph");
  lp.insert(0, [new Y.XmlText("first")]);
  li.insert(0, [lp]);
  const ul = new Y.XmlElement("bulletList");
  ul.insert(0, [li]);
  f.insert(0, [h, p, ul]);
  assert.equal(toMarkdown(y), "## Plan\n\nCall the client.\n\n- first");
  y.getText(BODY).insert(0, "plain wins");
  assert.equal(toMarkdown(y), "plain wins");
});

test("a device restarted offline keeps its edits (doc_local) and merges them when the socket returns", async () => {
  const rig = docRig();
  rig.allow("not_off", [ADA, BO]);
  const a = rig.device(ADA);
  const dA = a.client.open("not_off");
  dA.text().insert(0, "base");
  await rig.settle();
  const store = memoryDocStore();
  const b = rig.device(BO, { id: "dev_b", up: false, store });
  const first = b.client.open("not_off");
  first.text().insert(0, "offline edit. ");
  await Promise.resolve();
  assert.equal(store.get("not_off")?.dirty, true, "saved in the same tick, marked dirty");
  first.close();
  // Restart: a new client over the same store, still offline.
  const b2 = rig.device(BO, { id: "dev_b", up: false, store });
  const reopened = b2.client.open("not_off");
  assert.equal(reopened.text().toString(), "offline edit. ");
  assert.equal(reopened.dirty(), true);
  b2.up();
  await rig.settle();
  assert.equal(reopened.text().toString(), dA.text().toString());
  assert.ok(dA.text().toString().includes("offline edit. ") && dA.text().toString().includes("base"));
  assert.equal(reopened.dirty(), false);
  assert.deepEqual(versions(rig.s.host.tx, "not_off"), []);
});
