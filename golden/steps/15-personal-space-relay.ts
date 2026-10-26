// Golden flow 15: a Personal Space reached through the relay (spec 2.1, ARCH 5.13). The node is a Personal Space (--space-kind personal) with a relay link; the phone pairs with a code from the signed-in
// device, then does everything over the relay with its own token: its replica pulls, and a document the host edits reaches it as real Yjs text. The Personal matrix refuses what needs a Team Space,
// and revoking the phone ends it. Through the gateway with real tokens; the relay is a real relay node on loopback.
import assert from "node:assert/strict";
import * as Y from "yjs";
import { openChannel, request, webCrypto } from "../../relay/client/index.js";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { FlowSpace, Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_PERSONAL = ["spaces", "devices", "network", "access", "members", "documents", "identity", "records", "schema"];

/** Why this flow is a todo today (ruling 53). Empty when every step passes. */
export const GAPS: Gap[] = [];

const MEMO = { op: "type.create", type: "memo", def: { title: "Memo", plural: "Memos", icon: "file", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "body", type: "longtext", title: "Body" }] } };
const TEXT = "The Harlow filing moves to Thursday.";

interface RelayNode { listen(): Promise<string>; close(): Promise<void> | void }

export async function runPersonal(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  // the relay node is a plain ES module with no types (relay/ is not a layer host may import); load it by a computed path
  const relayPath = "../../relay/node/server.js";
  const { createRelay } = (await import(relayPath)) as { createRelay(): RelayNode };
  const relay = createRelay();
  const base = await relay.listen();
  let s = undefined as FlowSpace | undefined;
  await trail.step("a Personal node boots with sync live and a relay link", async () => { s = await bootFlowSpace([...live, "sync"], { spaceKind: "personal", relay: base, realClock: true }); });
  if (!s) {
    await trail.step("the same node boots with sync as a stub, to check what else is wired", async () => { s = await bootFlowSpace(live, { spaceKind: "personal", relay: base, realClock: true }); });
    if (!s) { await relay.close(); return { events: [], trail }; }
  }
  const synced = trail.lines.some((l) => l.startsWith("ok    a Personal node boots with sync live"));
  try {
    const space = s!, admin = space.d.token;
    await trail.step("the Space is Personal and says what it cannot do", async () => {
      const m = expectStatus(await space.call("spaces.matrix", admin, {}), 200, "spaces.matrix");
      assert.equal(m.kind, "personal", `matrix ${short(m)}`);
      assert.ok((m.features as { available: boolean }[]).some((f) => !f.available), `some feature is unavailable on a Personal Space: ${short(m)}`);
    });
    await trail.step("a Team-only call is refused with permission.needs_team", async () => {
      const r = await space.call("members.invites.create", admin, { role: "rol_member", idempotencyKey: "golden-15-invite" });
      assert.equal(r.body?.error?.code, "permission.needs_team", `members.invites.create on a Personal Space: ${r.status} ${short(r.body?.error ?? r.body)}`);
    });
    const relayEndpoint = await trail.step("the endpoint list carries the relay, healthy", async () => {
      const end = Date.now() + 15_000;
      for (;;) {
        const eps = expectStatus(await space.call("network.endpoints", admin, {}), 200, "network.endpoints").endpoints as { kind: string; url: string; health: string }[];
        const e = eps.find((x) => x.kind === "relay" && x.health === "healthy");
        if (e) {
          assert.match(e.url, /#box=[A-Za-z0-9_-]{43}$/, `the relay entry carries the pinned box key: ${e.url}`);   // kept from #575 (P-L7b_16)
          return e;
        }
        if (Date.now() > end) throw new Error(`no healthy relay endpoint after 15 s: ${short(eps)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    const phone = await trail.step("the phone pairs with a code from the signed-in device", async () => {
      const made = expectStatus(await space.call("identity.pair_create", admin, { idempotencyKey: "golden-15-pair", purpose: "app" }), 200, "identity.pair_create");
      const out = expectStatus(await space.call("identity.pair_redeem", null, { code: made.code as string, deviceName: "Olivia phone", deviceClass: "phone" }), 200, "identity.pair_redeem");
      assert.equal(out.status, "ok", `pair_redeem ${short(out)}`);
      return { device: out.session.deviceId as string, token: out.session.token as string };
    });
    /** The phone's call: through the relay, with its own token, as a person's phone would make it. */
    const viaRelay = async (path: string, body: unknown): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const url = new URL(relayEndpoint!.url);
      const route = url.searchParams.get("route") ?? "", box = Buffer.from(/^#box=(.+)$/.exec(url.hash)?.[1] ?? "", "base64url");
      const crypto = webCrypto();
      const { channel } = await openChannel({ relay: base, route, box: new Uint8Array(box), keys: await crypto.generateKeyPair(), crypto, WebSocket: globalThis.WebSocket, hello: { v: 1, name: "Olivia phone" }, timeout: 10_000 }) as { channel: { close(code: number, why: string): void } };
      try {
        const res = await request(channel, { method: "POST", path, headers: { "content-type": "application/json", authorization: `Bearer ${phone!.token}` } }, new TextEncoder().encode(JSON.stringify(body)));
        return { status: res.status, body: JSON.parse(await res.text()) };
      } finally { channel.close(1000, "done"); }
    };
    await trail.step("the phone's replica pulls through the relay", async () => {
      assert.ok(synced, "sync must be live for a pull to be answered by the real handler");
      const r = await viaRelay("/sync/v1/pull", { cursor: 0, epoch: 0 });
      assert.equal(r.status, 200, `pull through the relay: ${r.status} ${short(r.body)}`);
    }, ["the endpoint list carries the relay, healthy", "the phone pairs with a code from the signed-in device"]);
    const memo = await trail.step("the host makes a memo with a body", async () => {
      const t = await space.call("schema.apply", admin, { idempotencyKey: "golden-15-type", ops: [MEMO] });
      if (t.status !== 422 || t.body?.error?.code !== "validation.duplicate") expectStatus(t, 200, "schema.apply");
      return expectStatus(await space.call("records.create", admin, { idempotencyKey: "golden-15-memo", type: "memo", fields: { name: "Harlow", body: "" } }), 200, "records.create").record.id as string;
    });
    await trail.step("a document edited on the host reaches the phone as text", async () => {
      assert.ok(synced, "needs sync live");
      const ydoc = new Y.Doc();
      ydoc.getText("body").insert(0, TEXT);
      const update = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64");
      const sent = expectStatus(await space.call("sync.doc.update", admin, { doc: memo!, update }), 200, "sync.doc.update");
      assert.ok(sent.seq >= 1, `update ${short(sent)}`);
      const opened = await viaRelay("/v1/sync/doc/open", { doc: memo! });
      assert.equal(opened.status, 200, `the phone opens the document: ${opened.status} ${short(opened.body)}`);
      const phoneDoc = new Y.Doc();
      for (const u of opened.body.data.updates as string[]) Y.applyUpdate(phoneDoc, new Uint8Array(Buffer.from(u, "base64")));
      if (opened.body.data.snapshot) Y.applyUpdate(phoneDoc, new Uint8Array(Buffer.from(opened.body.data.snapshot as string, "base64")));
      assert.equal(phoneDoc.getText("body").toString(), TEXT);
      const types = (await space.events(false)).map((e) => e.type);
      assert.ok(types.includes("doc.updated"), `the update is in the log as doc.updated: ${types.slice(-12).join(", ")}`);
    }, ["the phone's replica pulls through the relay", "the host makes a memo with a body"]);
    await trail.step("refusal: the phone cannot revoke the host's other devices", async () => {
      const r = await space.call("devices.revoke", phone!.token, { deviceId: "dev_hostcomputer" });
      assert.ok(r.status >= 400 && r.status < 500, `a phone revoking a device it does not own: ${r.status}`);
    }, ["the phone pairs with a code from the signed-in device"]);
    await trail.step("revoking the phone ends it, through the relay too", async () => {
      expectStatus(await space.call("devices.revoke", admin, { deviceId: phone!.device }), 200, "devices.revoke");
      const r = await viaRelay("/sync/v1/pull", { cursor: 0, epoch: 0 });
      assert.equal(r.status, 401, `the phone's token after revoke: ${r.status}`);
    }, ["the phone pairs with a code from the signed-in device"]);
    return { events: await space.events(), trail };
  } finally { await s?.stop(); await relay.close(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runPersonal([]);
  if (trail.failures.length) throw new Error(`flow 15 failed:\n${trail.report()}`);
  return events;
}
