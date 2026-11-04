// The picture of an artifact: taken once, at load plus about a second, from the tab the person is looking at, small and masked; sent through the bridge as artifact.thumb; never for a page that is not an artifact.
import test from "node:test";
import assert from "node:assert/strict";
import { artifactHostOf, artifactOfTab, createArtifacts, THUMB_MAX } from "../src/worker/artifacts.js";
import { BRIDGE_OPS } from "../src/worker/protocol.js";

function world(o: { active?: boolean; sizes?: number[]; opResult?: unknown; tabUrl?: string } = {}) {
  const listeners: ((id: number, info: any) => void)[] = [];
  const ops: { op: string; input: any }[] = [];
  const waits: number[] = [];
  const paints: any[] = [];
  const sizes = [...(o.sizes ?? [100])];
  const ext = {
    tabs: {
      create: async () => ({ id: 7 }),
      get: async () => ({ id: 7, active: o.active ?? true, windowId: 1, incognito: false, url: o.tabUrl }),
      captureVisibleTab: async () => "data:image/png;base64,AAAA",
      onUpdated: { addListener: (f: any) => listeners.push(f), removeListener: (f: any) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } },
    },
    scripting: { executeScript: async () => [{ result: { rects: [], vw: 1000, vh: 700, dpr: 1 } }] },
  };
  const bridge = { op: async (op: string, input: any) => { ops.push({ op, input }); if (op === "artifact.open") return { url: "https://a.vyre.run/x/" + "a".repeat(48) }; return o.opResult ?? { set: true }; } };
  const paint = async (_raw: string, _where: any, opts: any) => { paints.push(opts); return { dataUrl: "data:image/webp;base64," + "A".repeat(sizes.shift() ?? 100), width: 480, height: 320, masked: 0 }; };
  const art = createArtifacts({ ext: ext as any, bridge, store: { get: async () => ({ spaces: [{ webUrl: "https://harbor.vyre.run" }] }) }, wait: async (ms: number) => { waits.push(ms); }, paint });
  return { art, listeners, ops, waits, paints };
}

test("opening an artifact in a tab takes its picture once when the page has loaded, a second after", async () => {
  const w = world();
  const out = await w.art.open({ id: "sit_abc" });
  assert.equal(out.handled, true);
  assert.equal(w.listeners.length, 1, "it waits for the tab to load");
  w.listeners[0]!(99, { status: "complete" });
  assert.equal(w.ops.filter((o) => o.op === "artifact.thumb").length, 0, "another tab does not count");
  w.listeners[0]!(7, { status: "loading" });
  w.listeners[0]!(7, { status: "complete" });
  assert.equal(w.listeners.length, 0, "once");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const sent = w.ops.find((o) => o.op === "artifact.thumb")!;
  assert.equal(sent.input.artifactId, "sit_abc");
  assert.match(sent.input.thumb, /^data:image\/webp;base64,/);
  assert.deepEqual(w.waits, [1000]);
  assert.equal(w.paints[0].maxW, 480);
  assert.equal(w.paints[0].type, "image/webp");
});

test("a picture over 60 KB is taken again smaller, and one that stays too big is not sent", async () => {
  const w = world({ sizes: [THUMB_MAX + 5, THUMB_MAX + 5, THUMB_MAX + 5] });
  assert.deepEqual(await w.art.thumb(7, "sit_abc"), { set: false, why: "too_large" });
  assert.equal(w.paints.length, 3);
  assert.deepEqual(w.paints.map((p) => p.quality), [0.7, 0.5, 0.35]);
  assert.equal(w.ops.some((o) => o.op === "artifact.thumb"), false);
  const w2 = world({ sizes: [THUMB_MAX + 5, 500] });
  assert.deepEqual(await w2.art.thumb(7, "sit_abc"), { set: true });
  assert.equal(w2.paints.length, 2);
});

test("a tab the person cannot see is not captured, and a page that is not an artifact is not asked about", async () => {
  const hidden = world({ active: false });
  assert.deepEqual(await hidden.art.thumb(7, "sit_abc"), { set: false, why: "not_visible" });
  assert.equal(hidden.ops.length, 0);
  const other = world();
  assert.deepEqual(await other.art.thumb(7, "not-an-artifact"), { set: false, why: "no_artifact" });
  assert.equal(other.paints.length, 0);
});

test("the Space keeping or declining the picture is told back, and the bridge lists the op", async () => {
  const w = world({ opResult: { set: false } });
  assert.deepEqual(await w.art.thumb(7, "sit_abc"), { set: false });
  assert.ok("artifact.thumb" in BRIDGE_OPS);
});

test("the artifact host of a Space: <name>-a.vyre.run through the relay, a.<address> served directly, a.localhost on this computer", () => {
  assert.equal(artifactHostOf("https://harbor.vyre.run"), "harbor-a.vyre.run");
  assert.equal(artifactHostOf("https://space.example.org"), "a.space.example.org");
  assert.equal(artifactHostOf("http://localhost:7421"), "a.localhost:7421");
  assert.equal(artifactHostOf("not an address"), null);
});

test("a tab on the signed-in Space's artifact host is an artifact; other hosts, the app itself and the one-time code address are not", () => {
  const spaces = ["https://harbor.vyre.run"];
  assert.equal(artifactOfTab("https://harbor-a.vyre.run/sit_abc123/", spaces), "sit_abc123");
  assert.equal(artifactOfTab("https://harbor-a.vyre.run/sit_abc123/page.html", spaces), "sit_abc123");
  assert.equal(artifactOfTab("https://harbor.vyre.run/sit_abc123/", spaces), null, "the app's origin never serves an artifact");
  assert.equal(artifactOfTab("https://evil-a.vyre.run/sit_abc123/", spaces), null, "a Space the person is not signed in to");
  assert.equal(artifactOfTab("https://harbor-a.vyre.run/x/" + "a".repeat(48), spaces), null);
});

test("a person who opens the plain link themselves gets the picture taken too, once, with no artifact.open", async () => {
  const w = world({ tabUrl: "https://harbor-a.vyre.run/sit_xyz/" });
  w.art.watchTabs();
  assert.equal(w.listeners.length, 1);
  w.listeners[0]!(7, { status: "loading" });
  w.listeners[0]!(7, { status: "complete" });
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  const sent = w.ops.filter((o) => o.op === "artifact.thumb");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.input.artifactId, "sit_xyz");
  assert.equal(w.ops.some((o) => o.op === "artifact.open"), false);
  // loading it again soon after does not ask again
  w.listeners[0]!(7, { status: "complete" });
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  assert.equal(w.ops.filter((o) => o.op === "artifact.thumb").length, 1);
});

test("a tab that is not an artifact is left alone", async () => {
  const w = world({ tabUrl: "https://news.example.com/" });
  w.art.watchTabs();
  w.listeners[0]!(7, { status: "complete" });
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  assert.equal(w.ops.length, 0);
  assert.equal(w.paints.length, 0);
});
