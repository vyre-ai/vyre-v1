// @reads /modules/dropbox/handlers/hook.ts
// The Dropbox change notice (/hooks/dropbox): the signature over the raw body is checked before anything is recorded, the same delivery twice is one event, and the module's handler map is the manifest's.
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/dropbox.ts";
import mountsManifest from "../../../manifests/mounts.ts";
import { handlers, hostCalls } from "../impl.ts";
import * as d from "../handlers/index.ts";
import { useContract, APP_SECRET, NOW, codeOf, harness, refusedWith } from "../fixtures/harness.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";

useContract(manifest, [mountsManifest]);

const BODY = JSON.stringify({ list_folder: { accounts: ["dbid:AAH4f99T0taONIb", "dbid:BBB"] }, delta: { users: [1, 2] } });

async function sign(body: string, secret = APP_SECRET): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))).toString("hex");
}

test("verifyWebhook accepts the signed body and names the accounts; the id is the body's hash", async () => {
  const v = await d.verifyWebhook(APP_SECRET, { "x-dropbox-signature": await sign(BODY) }, BODY, NOW);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.deepEqual(v.input.accounts, ["dbid:AAH4f99T0taONIb", "dbid:BBB"]);
  assert.equal(v.input.eventId, (await d.sha256Hex(BODY)).slice(0, 32));
  assert.equal(v.input.at, NOW);
});

test("verifyWebhook refuses no signature, a wrong signature, another secret and a body that was changed", async () => {
  assert.deepEqual(await d.verifyWebhook(APP_SECRET, {}, BODY, NOW), { ok: false, reason: "no_signature" });
  assert.deepEqual(await d.verifyWebhook(APP_SECRET, { "x-dropbox-signature": "0".repeat(64) }, BODY, NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await d.verifyWebhook(APP_SECRET, { "x-dropbox-signature": await sign(BODY, "other") }, BODY, NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await d.verifyWebhook(APP_SECRET, { "x-dropbox-signature": await sign(BODY) }, `${BODY} `, NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await d.verifyWebhook(APP_SECRET, { "x-dropbox-signature": "short" }, BODY, NOW), { ok: false, reason: "bad_signature" });
});

test("a signed body that is not a Dropbox change notice is a bad body, after the signature", async () => {
  for (const body of ["not json", "{}", "[]"]) {
    assert.deepEqual(await d.verifyWebhook(APP_SECRET, { "x-dropbox-signature": await sign(body) }, body, NOW), { ok: false, reason: "bad_body" }, body);
  }
  const empty = JSON.stringify({ list_folder: { accounts: [] } });
  const v = await d.verifyWebhook(APP_SECRET, { "x-dropbox-signature": await sign(empty) }, empty, NOW);
  assert.ok(v.ok && v.input.accounts.length === 0, "a notice for no accounts is still a notice");
});

test("receive_webhook records a delivery once and says which accounts changed", async () => {
  const h = harness();
  const input = { eventId: "e".repeat(32), accounts: ["dbid:AAH4f99T0taONIb"], at: NOW };
  assert.deepEqual(await d.receiveWebhook(h.ctx, input), { accepted: true });
  assert.deepEqual(await d.receiveWebhook(h.ctx, input), { accepted: true });
  assert.deepEqual(h.calls("mounts.nudge").map((c) => c.input), [{ source: "dropbox", channelId: "dbx:dbid:AAH4f99T0taONIb" }], "the mounts on that account are woken once, with the account as the channel");
  assert.deepEqual(h.named("dropbox.changes_received").map((e) => e.payload), [{ eventId: "e".repeat(32), accounts: ["dbid:AAH4f99T0taONIb"] }], "the second delivery changes nothing");
  assert.equal(h.rows(`SELECT * FROM dropbox_event`).length, 1);
  h.advance(25 * 3600_000);
  await d.receiveWebhook(h.ctx, { ...input, eventId: "f".repeat(32) });
  assert.deepEqual(h.rows(`SELECT "eventId" FROM dropbox_event`).map((r) => r["eventId"]), ["f".repeat(32)], "events older than a day are forgotten");
  assert.equal(await refusedWith(d.receiveWebhook(h.ctx, { accounts: [] })), "validation.bad_input");
});

const host = (h: ReturnType<typeof harness>): Ctx => ({ ...h.ctx, principal: { kind: "service", id: "svc_host" }, origin: "hook", depth: 0 }) as never;

test("a mount that cannot be woken does not fail the notice: the poll still finds the change", async () => {
  const h = harness();
  h.script("mounts.nudge", () => { throw h.err("internal.unavailable", "down"); });
  assert.deepEqual(await d.receiveWebhook(h.ctx, { eventId: "n".repeat(32), accounts: ["dbid:A", "dbid:B"], at: NOW }), { accepted: true });
  assert.equal(h.calls("mounts.nudge").length, 2, "every account was tried");
  assert.equal(h.named("dropbox.changes_received").length, 1);
});

test("the host call checks the signature with the app secret from the Vault, then records the delivery", async () => {
  const h = harness();
  h.connect();
  const ctx = host(h);
  const out = await hostCalls["dropbox.accept_webhook"](ctx, { headers: { "x-dropbox-signature": await sign(BODY) }, body: BODY, url: "https://space.vyre.test/hooks/dropbox" });
  assert.deepEqual(out, { accepted: true });
  assert.equal(h.named("dropbox.changes_received").length, 1);
  for (const [headers, body, code] of [[{}, BODY, "auth.bad_credentials"], [{ "x-dropbox-signature": "a".repeat(64) }, BODY, "auth.bad_credentials"], [{ "x-dropbox-signature": await sign("x") }, "x", "validation.bad_input"]] as const) {
    let caught: unknown;
    try { await hostCalls["dropbox.accept_webhook"](ctx, { headers, body, url: "u" }); } catch (e) { caught = e; }
    assert.equal(codeOf(caught), code);
  }
  assert.equal(h.named("dropbox.changes_received").length, 1, "nothing was recorded for a refused request");
  const unset = harness();
  assert.equal(codeOf(await hostCalls["dropbox.accept_webhook"](host(unset), { headers: { "x-dropbox-signature": "x" }, body: BODY, url: "u" }).catch((e) => e)), "auth.bad_credentials", "no app set up: nobody can sign for it");
  // a member cannot post the same body to the capability that records it: only the route, after its check, may
  const member = { ...h.ctx, origin: "gateway", depth: 0 } as never;
  assert.equal(await refusedWith(Promise.resolve().then(() => handlers["dropbox.receive_webhook"]!(member, { eventId: "x", accounts: [], at: NOW } as never))), "permission.no_grant");
  assert.equal(await refusedWith(Promise.resolve().then(() => hostCalls["dropbox.accept_webhook"](member, { headers: {}, body: BODY, url: "u" }))), "permission.no_grant");
  assert.equal(h.named("dropbox.changes_received").length, 1);
});

test("the handler map is the manifest's capabilities, capability for capability", () => {
  const mine = (manifest.capabilities ?? []).map((c) => c.name).sort();
  assert.equal(mine.length, 18);
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  for (const name of mine) assert.equal(typeof handlers[name], "function", `${name} has a handler function`);
});

test("the manifest keeps its summaries short and its writes behind the Gate", () => {
  for (const c of manifest.capabilities ?? []) {
    assert.ok(c.summary.length <= 300, `${c.name} summary is ${c.summary.length} characters`);
    if (c.effects === "outward") assert.ok(c.gate, `${c.name} needs a gate act`);
  }
  const gate = Object.fromEntries((manifest.capabilities ?? []).filter((c) => c.gate).map((c) => [c.name, c.gate?.act]));
  assert.deepEqual(gate, { "dropbox.account.remove": "delete", "dropbox.files.upload": "post", "dropbox.files.create_folder": "post", "dropbox.files.delete": "delete", "dropbox.files.restore": "post" });
});
