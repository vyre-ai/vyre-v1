// Startup order (ARCH 7, speed b12): no network on the critical path; app.usable fires after the first list is rendered from SQL.
import test from "node:test";
import assert from "node:assert/strict";
import { startup, FIRST_LIST_SQL } from "./startup.ts";
import type { ReplicaPort, UiStateStore } from "./startup.ts";
import { resolveLastPlace, loaderFor, isPlace, PLACES } from "./places.ts";
import { startupMs } from "./marks.ts";
import { webUiStateStore } from "./persisted.ts";

function harness(lastPlace: string | null) {
  const log: string[] = [];
  const ui: UiStateStore = { read: () => ({ lastPlace, railOrder: ["home", "chat"] }), write: () => {} };
  const replica: ReplicaPort = {
    prepare<Row>(sql: string) {
      log.push(`prepare ${sql}`);
      return { all: () => { log.push(`sql ${sql}`); return [{ id: "r1", title: "Weekly sync" }] as unknown as Row[]; } };
    },
  };
  const queued: (() => void)[] = [];
  const deps = {
    ui, replica,
    render: (v: { place: string; rows: unknown[] }) => log.push(`render ${v.place} ${v.rows.length}`),
    connect: () => log.push("connect"),
    mark: (n: string) => log.push(`mark ${n}`),
    schedule: (fn: () => void) => { queued.push(fn); },
  };
  return { log, deps, queued };
}

test("order: start, prepared statements, SQL, render, usable; the connection opens only afterwards", () => {
  const h = harness("files");
  startup(h.deps);
  const at = (s: string) => h.log.findIndex((l) => l.startsWith(s));
  assert.equal(h.log[0], "mark app.start");
  assert.ok(at("prepare") > at("mark app.start"));
  assert.ok(at("sql") > at("prepare"), "statements are prepared before the first query");
  assert.ok(at("render") > at("sql"), "the first list is rendered from SQL rows");
  assert.ok(at("mark app.usable") > at("render"), "usable fires after the first list is rendered");
  assert.equal(at("connect"), -1, "no connection on the critical path");
  h.queued.forEach((fn) => fn());
  assert.ok(h.log.indexOf("connect") > at("mark app.usable"), "connect runs after usable");
});

test("no network on the critical path: fetch, WebSocket and XMLHttpRequest are never touched", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { fetch: g.fetch, WebSocket: g.WebSocket, XMLHttpRequest: g.XMLHttpRequest };
  const hits: string[] = [];
  g.fetch = () => { hits.push("fetch"); throw new Error("network"); };
  g.WebSocket = function () { hits.push("ws"); throw new Error("network"); };
  g.XMLHttpRequest = function () { hits.push("xhr"); throw new Error("network"); };
  try {
    const h = harness(null);
    startup(h.deps);
    assert.deepEqual(hits, []);
  } finally {
    Object.assign(g, saved);
  }
});

test("the last place comes from persisted state, else Home", () => {
  assert.equal(resolveLastPlace("records"), "records");
  assert.equal(resolveLastPlace("nonsense"), "home");
  assert.equal(resolveLastPlace(null), "home");
  const h = harness("records");
  assert.equal(startup(h.deps).place, "records");
  assert.ok(h.log.includes(`sql ${FIRST_LIST_SQL.records}`));
});

test("every place has a loader, and an unregistered place gets a dynamic import", () => {
  for (const p of PLACES) assert.equal(typeof loaderFor(p), "function");
  assert.ok(isPlace("vault") && !isPlace("x"));
});

test("startupMs measures app.start to app.usable", () => {
  assert.equal(startupMs([{ name: "app.start", startTime: 10 }, { name: "app.usable", startTime: 410 }]), 400);
  assert.equal(startupMs([{ name: "app.start", startTime: 10 }]), null);
});

test("the web UI state store reads synchronously, survives corrupt storage, and writes through", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const store = webUiStateStore(storage);
  assert.equal(store.read().lastPlace, null);
  store.write({ lastPlace: "mail" });
  assert.equal(webUiStateStore(storage).read().lastPlace, "mail");
  data.set("vyre.ui.v1", "{not json");
  assert.equal(webUiStateStore(storage).read().lastPlace, null);
});
