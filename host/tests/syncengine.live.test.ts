// P-H_09: the connectors sync engine. A booted daemon wires `setSyncEngine` (no connectors setter is reported as not set up), and the adapter over modules/sources works end to end against
// a fake connector reached through connectors.run: preview, a push that failed once and is pushed again, undo, an asked conflict (replay and resolve) and confirm_deletes.
// Host never imports a module (layer rule), so the sources engine is taken through the loader, the way the daemon takes it. A booted daemon is slow-shard material (test/slow.json).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon, CODE_ROOT } from "../src/daemon/daemon.ts";
import { fileExportsImporter } from "../src/loader.ts";
import { coreOf, createSyncEngine, namesFor, readRows, remoteStore } from "../src/daemon/syncengine.ts";
import type { BindingRow, EngineCtx, SyncBindingLike } from "../src/daemon/syncengine.ts";
import { createSpaceStore } from "../src/daemon/store.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("syncengine: readRows reads both list shapes and pages", () => {
  const hub = readRows({ results: [{ id: "1", properties: { a: 1 }, archived: true, updatedAt: "2026-01-01T00:00:00Z" }], paging: { next: { after: "9" } } });
  assert.deepEqual(hub.rows.map((r) => [r.id, r.archived, r.data]), [["1", true, { a: 1 }]]);
  assert.equal(hub.next, "9");
  assert.deepEqual(readRows({ rows: [{ id: 5, data: { b: 2 } }] }).rows.map((r) => [r.id, r.data]), [["5", { b: 2 }]]);
  assert.throws(() => readRows({ nope: 1 }), /list of results/);
  assert.throws(() => readRows("x"), /did not answer/);
});

test("syncengine: coreOf names what the sources module lacks", () => {
  assert.throws(() => coreOf(undefined), /not available/);
  assert.throws(() => coreOf({ runSync() {} }), /does not export flushOutbox/);
});

test("syncengine: the adapter runs preview, push, undo, an asked conflict and confirm_deletes against a fake connector", async () => {
  const sources = await fileExportsImporter(CODE_ROOT)("sources");
  const core = coreOf(sources);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncengine-"));
  const space = createSpaceStore({ path: path.join(dir, "space.db"), space: "sp_sync" });
  const { store, tx } = space.open();
  await store.define({ add_types: [{ name: "contact", label: "Contact", fields: [{ name: "name", kind: "text", label: "Name" }, { name: "email", kind: "text", label: "Email" }] }] });

  // the fake app: contacts by id; the first update of Ann fails once
  const app = new Map<string, Record<string, unknown>>([["h1", { full_name: "Ann", email_address: "ann@x.io" }], ["h2", { full_name: "Bo", email_address: "bo@x.io" }]]);
  let seq = 2;
  let failOnce = false;
  const calls: string[] = [];
  const ctx: EngineCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap, input) => {
      if (cap === "connectors.get") return { connector: { key: "fakeapp" } };   // no per-object map: the convention applies
      assert.equal(cap, "connectors.run");
      const i = input as { key: string; action: string; connectionId: string; input: { id?: string; properties?: Record<string, unknown> }; idempotencyKey: string };
      assert.equal(i.key, "fakeapp");
      assert.equal(i.connectionId, "con_1");
      assert.ok(i.idempotencyKey.length > 0);
      calls.push(i.action);
      switch (i.action) {
        case "list_contacts": return { output: { results: [...app].map(([id, properties]) => ({ id, properties })) } };
        case "create_contact": { const id = `h${++seq}`; app.set(id, { ...i.input.properties }); return { output: { id } }; }
        case "update_contact":
          if (failOnce) { failOnce = false; throw new Error("the app is busy"); }
          app.set(i.input.id!, { ...app.get(i.input.id!), ...i.input.properties });
          return { output: { id: i.input.id } };
        case "delete_contact": app.delete(i.input.id!); return { output: { id: i.input.id } };
        default: throw new Error(`no action ${i.action}`);
      }
    },
  };
  const row: BindingRow = {
    syncTypeId: "syt_1", type: "contact", connector: "fakeapp", connectionId: "con_1", remote: "contacts",
    fields: [{ key: "name", remote: "full_name", dir: "both" }, { key: "email", remote: "email_address", dir: "both" }],
    match: ["email"], createAtSource: false, deletes: "travel", conflict: "ask",
  };
  const binding: SyncBindingLike = {
    syncTypeId: "syt_1", type: "contact", remote: "contacts", connector: "fakeapp", label: "Fake app",
    fields: [{ local: "name", remote: "full_name", direction: "both" }, { local: "email", remote: "email_address", direction: "both" }],
    match: ["email"], createAtSource: false, deletes: true, conflict: "ask",
  };
  const engine = createSyncEngine({ core, local: { open: () => ({ store, tx }) } });
  const deps = () => ({ local: store, remote: remoteStore(ctx, row), tx });
  const localByEmail = async (email: string) => (await store.query("contact", { page: { limit: 50 } })).rows.find((r) => r.data["email"] === email)!;

  // preview writes nothing
  const pre = await engine.preview(ctx, row, { direction: "pull" });
  assert.equal(pre.creates, 2);
  assert.equal((await store.query("contact", { page: { limit: 50 } })).rows.length, 0, "a preview creates nothing");

  // a real pull
  await core.runSync(deps(), binding, { mode: "both" });
  const ann = await localByEmail("ann@x.io");
  assert.equal(ann.data["name"], "Ann");

  // a push that fails once stays pending; push() sends it
  failOnce = true;
  await store.update("contact", ann.id, { email: "ann@new.io" }, ann.version);
  await core.runSync(deps(), binding, { mode: "both" });
  const pending = tx.get<{ outbox_id: string; status: string }>("SELECT outbox_id, status FROM sy_outbox WHERE sync_type = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", "syt_1");
  assert.equal(pending?.status, "pending");
  const sent = await engine.push(ctx, row, pending!.outbox_id);
  assert.deepEqual(sent, { state: "sent" });
  assert.equal(app.get("h1")!["email_address"], "ann@new.io");

  // undo puts the replaced value back in the app
  const undone = await engine.undoPush(ctx, row, pending!.outbox_id);
  assert.deepEqual(undone, { undone: true });
  assert.equal(app.get("h1")!["email_address"], "ann@x.io");

  // both sides change Bo's name: the rule is ask, so a conflict opens; replay lists what each rule would pick; resolve takes theirs
  const bo = await localByEmail("bo@x.io");
  await store.update("contact", bo.id, { name: "Bobby" }, bo.version);
  app.set("h2", { ...app.get("h2"), full_name: "Robert" });
  await core.runSync(deps(), binding, { mode: "both" });
  const open = tx.get<{ conflict_id: string }>("SELECT conflict_id FROM sy_conflicts WHERE sync_type = ? AND status = 'open'", "syt_1");
  assert.ok(open, "a conflict is open");
  const replay = await engine.replayConflict(ctx, row, open!.conflict_id);
  assert.deepEqual(replay.map((r) => r.rule), ["newest", "source", "vyre", "ask"]);
  assert.equal(replay.find((r) => r.rule === "source")!.value, "Robert");
  assert.equal(replay.find((r) => r.rule === "vyre")!.value, "Bobby");
  const settled = await engine.resolveConflict(ctx, row, open!.conflict_id, "theirs");
  assert.equal(settled.recordId, bo.id);
  assert.equal((await store.get("contact", bo.id))!.data["name"], "Robert");

  // a removal travels with delete_contact; undoing it creates the app record again from the snapshot taken before the delete
  const annNow = (await store.query("contact", { page: { limit: 50 } })).rows.find((r) => r.data["name"] === "Ann")!;
  assert.ok(annNow, "Ann is still a local record");
  await store.remove("contact", annNow.id, annNow.version);
  await core.runSync(deps(), binding, { mode: "both" });
  assert.ok(calls.includes("delete_contact"), "the removal went out as delete_contact");
  assert.equal(app.has("h1"), false, "the record is gone from the app");
  const removal = tx.get<{ outbox_id: string }>("SELECT outbox_id FROM sy_outbox WHERE sync_type = ? AND op = 'remove' AND status = 'done'", "syt_1");
  assert.ok(removal, "the removal is in the outbox as done");
  const back = await engine.undoPush(ctx, row, removal!.outbox_id);
  assert.deepEqual(back, { undone: true });
  assert.ok([...app.values()].some((p) => p["email_address"] === "ann@x.io" || p["email_address"] === "ann@new.io"), "the app record is created again from the snapshot");
  assert.ok(calls.filter((c) => c === "create_contact").length >= 1);
  // no snapshot, no silent guess
  tx.run("UPDATE sy_outbox SET status = 'done', undone_at = NULL, replaced = NULL WHERE outbox_id = ?", removal!.outbox_id);
  const refused = await engine.undoPush(ctx, row, removal!.outbox_id);
  assert.equal(refused.undone, false);
  assert.match(refused.reason ?? "", /cannot be put back/);

  // nothing is waiting on a delete decision
  assert.equal(await engine.confirmDeletes(ctx, row, "keep"), 0);
  space.close();
});

test("syncengine live: a booted daemon wires setSyncEngine and reports no connectors setter as not set up", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncengine-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "syncengine-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module === "connectors"), [], "no connectors setter is reported as not set up");
    assert.ok(d.seams?.wired.includes("setSyncEngine"), "setSyncEngine is wired");
  } finally { await d.stop(); }
});

test("syncengine: a connector spec may name its own actions per object; names it leaves out keep the convention", async () => {
  assert.deepEqual(namesFor({ contact: { list: "find_all", create: "add_one", bogus: 1 } }, "contacts"), { list: "find_all", create: "add_one" });
  assert.deepEqual(namesFor({ contacts: { delete: "remove_it" } }, "contacts"), { delete: "remove_it" });
  assert.deepEqual(namesFor(undefined, "contacts"), {});
  const seen: string[] = [];
  const call = async (_cap: string, input: unknown): Promise<unknown> => {
    const i = input as { action: string };
    seen.push(i.action);
    if (i.action === "find_all") return { output: { rows: [{ id: "a", data: { n: 1 } }], next: "p2" } };
    if (i.action === "find_more") return { output: { rows: [{ id: "b", data: { n: 2 } }] } };
    return { output: { id: "z" } };
  };
  const b = { connector: "odd", connectionId: "con_9", remote: "contacts" };
  const s = remoteStore({ call }, b, { contact: { list: "find_all", listAfter: "find_more", create: "add_one", update: "change_one", delete: "remove_one" } });
  assert.equal((await s.query("contacts", { page: { limit: 10 } })).rows.length, 2);
  await s.create("contacts", "", { n: 3 });
  await s.update("contacts", "a", { n: 4 }, 1);
  await s.remove("contacts", "a", 1);
  assert.deepEqual(seen, ["find_all", "find_more", "add_one", "change_one", "remove_one"]);
  seen.length = 0;
  const plain = remoteStore({ call }, b, { contact: { list: "find_all" } });
  await plain.create("contacts", "", { n: 3 });
  assert.deepEqual(seen, ["create_contact"], "a name the spec leaves out keeps the convention");
});

test("syncengine live: a real connector row with an override makes the sync call the overridden action names", async () => {
  const connectors = await fileExportsImporter(CODE_ROOT)("connectors");
  assert.ok(connectors, "connectors loads");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncengine-row-"));
  const space = createSpaceStore({ path: path.join(dir, "space.db"), space: "sp_row" });
  const seams = connectors["hostSeams"] as Record<string, (s: unknown) => void>;
  seams["setConnectorsSpaceStore"]!(space);
  const hs = connectors["handlers"] as Record<string, (ctx: unknown, input: unknown) => Promise<unknown>>;
  const hctx = { trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" }, emit: () => ({}), call: () => Promise.reject(new Error("no calls")), actor: "usr_owner", principal: { id: "usr_owner" } };
  try {
    await hs["connectors.list"]!(hctx, {});   // creates and seeds the connector tables on the Space store
    const { store, tx } = space.open();
    await store.define({ add_types: [{ name: "contact", label: "Contact", fields: [{ name: "name", kind: "text", label: "Name" }, { name: "email", kind: "text", label: "Email" }] }] });
    const def = {
      key: "oddapp", title: "Odd app", mode: "api", scope: "space", version: "1.0.0", auth: { type: "none" }, domains: [], secrets: [], actions: [],
      objects: { contact: { list: "find_all", create: "add_one" } },
    };
    tx.run("INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, 'live', ?, 0, 0)", def.key, def.title, def.mode, def.scope, def.version, JSON.stringify(def));
    const seen: string[] = [];
    const ctx: EngineCtx = {
      trace: { traceId: "0123456789abcdef0123456789abcdef" },
      emit: () => ({}),
      call: async (cap, input) => {
        if (cap === "connectors.get") return hs["connectors.get"]!(hctx, input);   // the real handler over the real row
        assert.equal(cap, "connectors.run");
        const i = input as { action: string };
        seen.push(i.action);
        if (i.action === "find_all") return { output: { results: [{ id: "h1", properties: { full_name: "Ann", email_address: "ann@x.io" } }] } };
        return { output: { id: "h9" } };
      },
    };
    const got = await hs["connectors.get"]!(hctx, { key: "oddapp" }) as { connector: { objects?: unknown } };
    assert.deepEqual(got.connector.objects, { contact: { list: "find_all", create: "add_one" } }, "connectors.get carries the objects map");
    const row: BindingRow = {
      syncTypeId: "syt_1", type: "contact", connector: "oddapp", connectionId: "con_1", remote: "contacts",
      fields: [{ key: "name", remote: "full_name", dir: "both" }, { key: "email", remote: "email_address", dir: "both" }],
      match: ["email"], createAtSource: false, deletes: "travel", conflict: "ask",
    };
    const sources = coreOf(await fileExportsImporter(CODE_ROOT)("sources"));
    const engine = createSyncEngine({ core: sources, local: { open: () => ({ store, tx }) } });
    const pre = await engine.preview(ctx, row, { direction: "pull" });
    assert.equal(pre.creates, 1);
    assert.deepEqual(seen, ["find_all"], "the sync called the overridden list name, not list_contacts");
  } finally {
    seams["setConnectorsSpaceStore"]!(null);
    space.close();
  }
});
