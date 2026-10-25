// Kit runtime: a screen renders from a KitScreenDef (layout, builtin, every state) and its probes use the generated ids.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { KitScreen } from "../runtime/KitScreen.tsx";
import { createBuiltinRegistry, type KitScreenContext } from "../runtime/builtins.ts";
import { probeId, startProbe, type TimingApi } from "../runtime/probes.ts";
import { fakeEnv, listDef, people } from "./fakes.tsx";
import { Text } from "react-native";
import type { KitScreenDef } from "../types.ts";

const esc = (t: string) => t.replaceAll("&", "&amp;");
const rows = (html: string) => html.match(/data-testid="row-\d+"/g)?.length ?? 0;

test("a Kit screen renders from KitScreenDef: one ui/Row per item with title and note", () => {
  const html = renderToStaticMarkup(<KitScreen def={listDef} env={fakeEnv({ data: { people } })} />);
  for (const p of people) {
    assert.ok(html.includes(esc(p.name)), p.name);
    assert.ok(html.includes(esc(p.company)), p.company);
  }
  assert.equal(rows(html), 3);
  assert.match(html, /aria-label="Omar Haddad"/, "the row's title is its accessible name");
  assert.match(html, /data-testid="kit-screen-demo\.list"/);
  assert.ok(!html.includes("{/row"), "no raw pointer text left");
});

test("loading shows a skeleton and no rows", () => {
  const html = renderToStaticMarkup(<KitScreen def={listDef} env={fakeEnv({ loading: ["people"] })} />);
  assert.match(html, /data-testid="kit-skeleton"/);
  assert.equal(rows(html), 0);
});

test("empty, offline and error states carry the def's lines and actions", () => {
  const empty = renderToStaticMarkup(<KitScreen def={listDef} env={fakeEnv({ data: { people: [] } })} />);
  assert.match(empty, /No people yet/);
  assert.match(empty, /Add a person/);
  const offDef: KitScreenDef = { ...listDef, queries: { people: { ...listDef.queries.people!, live: false } } };
  const offline = renderToStaticMarkup(<KitScreen def={offDef} env={fakeEnv({ online: false, read: () => new Promise(() => {}) })} />);
  assert.match(offline, /data-testid="state-offline"/);
  assert.match(offline, /Offline/);
  const failing = fakeEnv({ traceId: "tr_123", hooks: { query: () => { throw new Error("no such query"); } } });
  const error = renderToStaticMarkup(<KitScreen def={listDef} env={failing} />);
  assert.match(error, /data-testid="state-error"/);
  for (const text of ["People did not load", "Retry", "Copy trace id", "Report a problem", "tr_123"]) assert.ok(error.includes(text), text);
});

test("a registered builtin renders in place of a layout; an unregistered one says so", () => {
  const reg = createBuiltinRegistry();
  reg.register("ui:Demo", ({ screen }) => <Text>{`${screen.def.id}:${screen.status}`}</Text>);
  const def: KitScreenDef = { id: "demo.builtin", place: "records", slot: "main", builtin: "ui:Demo", queries: {}, actions: {}, states: listDef.states };
  const html = renderToStaticMarkup(<KitScreen def={def} env={fakeEnv()} builtins={reg} />);
  assert.match(html, /demo\.builtin:ready/);
  const missing = renderToStaticMarkup(<KitScreen def={{ ...def, builtin: "ui:Nope" }} env={fakeEnv()} builtins={reg} />);
  assert.match(missing, /ui:Nope is not available in this build/);
});

test("an action resolves its input from the row, asks first when the def says confirm, and calls the capability", async () => {
  let ctx: KitScreenContext | undefined;
  const reg = createBuiltinRegistry();
  reg.register("ui:Capture", ({ screen }) => { ctx = screen; return null; });
  const def: KitScreenDef = { ...listDef, builtin: "ui:Capture" };
  const asked: string[] = [];
  const env = fakeEnv({ data: { people }, confirm: async (t) => { asked.push(t); return asked.length > 1; } });
  renderToStaticMarkup(<KitScreen def={def} env={env} builtins={reg} />);
  assert.ok(ctx);
  ctx.run("open", people[1]);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(env.invoked.map((i) => i.input), [{ id: "p2" }]);
  ctx.run("remove", people[0]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(env.invoked.length, 1, "declined confirmation does not call");
  ctx.run("remove", people[0]);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(asked, ["Delete this record?", "Delete this record?"]);
  assert.deepEqual(env.invoked.at(-1)?.input, { id: "p1" });
});

test("probe marks are emitted with the generated ids", () => {
  const generated = JSON.parse(readFileSync(new URL("../../../../generated/probes.json", import.meta.url), "utf8")) as { probes: { id: string; screen?: string; firstPaintMs: number; completeMs: number }[] };
  const screens = generated.probes.filter((p) => p.screen);
  assert.ok(screens.length >= 20, "the generated catalog has screens");
  for (const p of screens) assert.equal(probeId(p.screen!), p.id, `probe id for ${p.screen}`);
  const measures: { name: string; start: number; end: number }[] = [];
  let t = 100;
  const timing: TimingApi = { now: () => t, measure: (name, o) => { measures.push({ name, ...o }); } };
  const sample = screens[0]!;
  const probe = startProbe({ id: sample.screen!, perf: { firstPaintMs: sample.firstPaintMs, completeMs: sample.completeMs } }, timing);
  t = 120; probe.firstPaint(); probe.firstPaint();
  t = 150; probe.complete(); probe.complete();
  assert.deepEqual(measures.map((m) => m.name), [`${sample.id}.first-paint`, sample.id], "each mark once, named from the generated id");
  assert.deepEqual(probe.result(), { id: sample.id, firstPaintMs: 20, completeMs: 50, withinBudget: true });
  const none = startProbe({ id: "x.y" }, timing);
  none.firstPaint(); none.complete();
  assert.equal(measures.length, 2, "a def without perf measures nothing");
});
