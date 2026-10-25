// @reads /modules/sync/migrations/0001_pull.sql
// The rig the document tests share: a real log and store behind the document server, the live layer over it, and device clients wired to it through a link that a test can cut.
// Frames cross the link as JSON, so nothing travels that could not travel on a socket. This file also checks the rig, so importing it from another test file adds one small test.
import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import type { NewEvent } from "../../../kernel/src/log/types.ts";
import type { Frame } from "../../../sync/src/protocol.ts";
import { BODY, createDocClient, createDocServer, createDocLive, fromB64, memoryDocStore, newDoc, toB64 } from "../docs/index.ts";
import type { DocClient, DocCrypto, DocDecision, DocEnc, DocLive, DocOwner, DocPeer, DocServer, DocVerb } from "../docs/index.ts";
import { openSync } from "../impl.ts";
import type { SyncHandle } from "../impl.ts";
import { ADA, BO, CY, NOW, buildAccess } from "../fixtures/world.ts";

export { ADA, BO, CY, NOW };
export const AGENT = "agt_scribe";
export const TRACE = "0123456789abcdef0123456789abcdef";
export const ctx = (principal: string): { trace: { traceId: string }; principal: string } => ({ trace: { traceId: TRACE }, principal });

export interface Acl { view: Set<string>; edit: Set<string>; enc: DocEnc; owner?: DocOwner | undefined }

export interface Device {
  person: string;
  peer: DocPeer;
  client: DocClient;
  store: ReturnType<typeof memoryDocStore>;
  problems: { doc: string; code: string; dropped: boolean }[];
  /** The socket is up: frames flow both ways and every open document starts its handshake. */
  up(): void;
  /** The socket dropped. */
  down(): void;
}

export interface DocRig {
  s: SyncHandle;
  server: DocServer;
  live: DocLive;
  events: NewEvent[];
  projected: { owner: DocOwner; md: string; doc: string }[];
  clock: { t: number };
  acl: Map<string, Acl>;
  /** Let these people view and edit a document. */
  allow(doc: string, people: string[], o?: { enc?: DocEnc; owner?: DocOwner; viewOnly?: string[] }): void;
  /** Take access away. */
  revoke(doc: string, person: string, what?: "edit" | "all"): void;
  device(person: string, o?: { id?: string; crypto?: DocCrypto; up?: boolean; store?: ReturnType<typeof memoryDocStore> }): Device;
  /** Wait until every frame in flight has been applied. */
  settle(): Promise<void>;
  /** Errors thrown while a device applied a frame (a wrong key, for one). */
  errors: unknown[];
}

const clone = (f: Frame): Frame => JSON.parse(JSON.stringify(f)) as Frame;

export function docRig(o: { compactEvery?: number; compactMs?: number } = {}): DocRig {
  const clock = { t: NOW };
  const s = openSync({ access: () => buildAccess(), clock: () => clock.t });
  const acl = new Map<string, Acl>();
  const events: NewEvent[] = [];
  const projected: DocRig["projected"] = [];
  const errors: unknown[] = [];
  const pending: Promise<void>[] = [];
  const server = createDocServer({
    db: s.host.tx,
    access: {
      decide(who: string, doc: string, verb: DocVerb): DocDecision {
        const a = acl.get(doc);
        if (!a) return { ok: false, reason: "missing" };
        const ok = verb === "view" ? a.view.has(who) || a.edit.has(who) : a.edit.has(who);
        return ok ? { ok: true, enc: a.enc, owner: a.owner } : { ok: false, reason: "denied" };
      },
    },
    append: (ev) => { events.push(ev); return s.host.append(ev); },
    now: () => clock.t,
    project: (owner, md, doc) => { projected.push({ owner, md, doc }); },
    ...(o.compactEvery !== undefined ? { compactEvery: o.compactEvery } : {}),
    ...(o.compactMs !== undefined ? { compactMs: o.compactMs } : {}),
  });
  const live = createDocLive(server, { traceId: () => TRACE });
  let n = 0;
  const rig: DocRig = {
    s, server, live, events, projected, clock, acl, errors,
    allow(doc, people, oo = {}) {
      const view = new Set(oo.viewOnly ?? []);
      acl.set(doc, { view, edit: new Set(people), enc: oo.enc ?? 0, owner: oo.owner });
    },
    revoke(doc, person, what = "all") {
      const a = acl.get(doc);
      if (!a) return;
      a.edit.delete(person);
      if (what === "edit") a.view.add(person); else a.view.delete(person);
    },
    device(person, oo = {}) {
      const store = oo.store ?? memoryDocStore();
      const problems: Device["problems"] = [];
      const client = createDocClient({ store, ...(oo.crypto ? { crypto: oo.crypto } : {}), onProblem: (doc, p) => { problems.push({ doc, code: p.code, dropped: p.dropped }); } });
      const peer: DocPeer = { person, device: oo.id ?? `dev_${++n}` };
      let detach: (() => void) | null = null;
      const dev: Device = {
        person, peer, client, store, problems,
        up() {
          if (detach) return;
          detach = live.attach(peer, (f) => { pending.push(client.onFrame(clone(f)).catch((e: unknown) => { errors.push(e); })); });
          client.attach({ send: (f) => { live.onFrame(peer, clone(f)); } });
        },
        down() {
          detach?.();
          detach = null;
          client.attach(null);
        },
      };
      if (oo.up !== false) dev.up();
      return dev;
    },
    async settle() {
      for (let i = 0; i < 10; i++) {
        await Promise.all(pending.splice(0));
        await new Promise<void>((r) => setImmediate(r));
      }
    },
  };
  return rig;
}

/** A Yjs update that inserts `text` at `at` into a document that already holds `from` (updates applied in order). */
export function edit(from: Uint8Array[], at: number, text: string): Uint8Array {
  const y = newDoc();
  for (const u of from) Y.applyUpdate(y, u);
  let out = new Uint8Array(0);
  y.on("update", (u: Uint8Array) => { out = u; });
  y.getText(BODY).insert(at, text);
  return out;
}

export const b64 = toB64;
export const un64 = fromB64;

test("the doc rig: a device types, the other device sees it, a cut link keeps the edit until it returns", async () => {
  const rig = docRig();
  rig.allow("not_rig", [ADA, BO]);
  const a = rig.device(ADA), b = rig.device(BO);
  const da = a.client.open("not_rig"), db = b.client.open("not_rig");
  da.text().insert(0, "hello");
  await rig.settle();
  assert.equal(db.text().toString(), "hello");
  b.down();
  db.text().insert(5, " world");
  assert.equal(db.dirty(), true);
  await rig.settle();
  assert.equal(da.text().toString(), "hello");
  b.up();
  await rig.settle();
  assert.equal(da.text().toString(), "hello world");
  assert.equal(db.dirty(), false);
  assert.deepEqual(rig.errors, []);
});
