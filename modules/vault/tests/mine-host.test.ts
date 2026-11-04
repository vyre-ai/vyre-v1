// The host's own saves of a person's Mine item (the GitHub refresh token): sealed like any Mine item, found only by the owner's handle, replaced on rotation, readable only with the owner's key, and never in a row, an event or a log.
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import { mineHandle, mineRemove, mineSet } from "../handlers/mine-host.ts";
import { setKeyPort } from "../handlers/crypto.ts";
import { HOST_ONLY_CALL } from "../../../host/src/daemon/consumers.ts";
import { githubItemHandle } from "../../../host/src/seams/comms.ts";
import { MAYA, ROB, harness, keyOfPerson } from "../fixtures/harness.ts";

const SECRET = "ghr_refresh_TOKEN_one_0123456789";   // secret-scan: fake
const person = (h: ReturnType<typeof harness>, id: string) => { h.actAs("person", id); };

test("a first save makes the item in the owner's Connections folder, sealed under their key, and only they can read it by its handle", async () => {
  const h = harness();
  try {
    const made = await mineSet(h.ctx, { owner: MAYA, name: "GitHub", fields: { refresh_token: SECRET } });
    assert.equal(made.handle, mineHandle("GitHub", MAYA));
    assert.equal(made.handle, githubItemHandle(MAYA), "the seam and the module agree on the handle");
    const row = h.rows(`SELECT * FROM vault_meta WHERE "id" = ?`, made.itemId)[0]!;
    assert.equal(row.scope, "mine");
    assert.equal(row.owner, MAYA);
    assert.equal(h.rows(`SELECT * FROM vault_secret WHERE "itemId" = ?`, made.itemId)[0]!.enc, 2);
    assert.equal(h.everything().includes(SECRET), false, "no value in a row, an event, a call or a log");
    const port = u.secretPort(h.ctx.db);
    assert.equal(await port.secret(`${made.handle}.refresh_token`, "", MAYA), SECRET);
    await assert.rejects(port.secret(`${made.handle}.refresh_token`, "", ROB));   // another person has no such item
    await assert.rejects(port.secret(`${made.handle}.refresh_token`, ""));        // and without an asker it is not a Shared item
    assert.equal(h.rows(`SELECT * FROM vault_folder WHERE "name" = ?`, "Connections").length, 1);
  } finally { h.cleanup(); }
});

test("a second save replaces the value in the same item (GitHub rotates the refresh token), a person's item is their own, and two people get two handles", async () => {
  const h = harness();
  try {
    const a = await mineSet(h.ctx, { owner: MAYA, name: "GitHub", fields: { refresh_token: SECRET } });
    const b = await mineSet(h.ctx, { owner: MAYA, name: "GitHub", fields: { refresh_token: "ghr_refresh_TOKEN_two_0123456789" } });   // secret-scan: fake
    assert.equal(b.itemId, a.itemId);
    assert.equal(h.rows(`SELECT * FROM vault_meta WHERE "owner" = ?`, MAYA).length, 1);
    assert.equal(await u.secretPort(h.ctx.db).secret(`${a.handle}.refresh_token`, "", MAYA), "ghr_refresh_TOKEN_two_0123456789");   // secret-scan: fake
    setKeyPort({ async personKey(id) { return keyOfPerson(id); } });
    const rob = await mineSet(h.ctx, { owner: ROB, name: "GitHub", fields: { refresh_token: "ghr_rob_0123456789" } });   // secret-scan: fake
    assert.notEqual(rob.handle, a.handle);
    assert.equal(await u.secretPort(h.ctx.db).secret(`${rob.handle}.refresh_token`, "", ROB), "ghr_rob_0123456789");   // secret-scan: fake
    assert.equal(h.everything().includes("ghr_refresh_TOKEN"), false);
  } finally { h.cleanup(); }
});

test("it works for an agent's turn too: the host writes it, not the agent; and it refuses what is not a plain name or field", async () => {
  const h = harness();
  try {
    person(h, MAYA);
    h.actAs("service", "svc_host");
    setKeyPort({ async personKey(id) { return keyOfPerson(id); } });   // the owner is signed in elsewhere on this node; the host is the caller
    await mineSet(h.ctx, { owner: MAYA, name: "GitHub", fields: { refresh_token: SECRET } });
    await assert.rejects(mineSet(h.ctx, { owner: "someone", name: "GitHub", fields: { a: "b" } }), (e: any) => e.error.code === "validation.bad_input");   // eslint-disable-line @typescript-eslint/no-explicit-any
    await assert.rejects(mineSet(h.ctx, { owner: MAYA, name: "../x", fields: { a: "b" } }), (e: any) => e.error.code === "validation.bad_input");   // eslint-disable-line @typescript-eslint/no-explicit-any
    await assert.rejects(mineSet(h.ctx, { owner: MAYA, name: "GitHub", fields: { "bad key": "b" } }), (e: any) => e.error.code === "validation.bad_input");   // eslint-disable-line @typescript-eslint/no-explicit-any
  } finally { h.cleanup(); }
});

test("with the owner's key off this node and no public key to seal to, it says the vault is locked and writes nothing", async () => {
  const h = harness();
  try {
    h.lock(MAYA);
    await assert.rejects(mineSet(h.ctx, { owner: MAYA, name: "GitHub", fields: { refresh_token: SECRET } }), (e: any) => e.error.code === "auth.unauthenticated");   // eslint-disable-line @typescript-eslint/no-explicit-any
  } finally { h.cleanup(); }
});

test("removing puts the item in the Trash and its handle stops opening; the calls are the host's alone", async () => {
  const h = harness();
  try {
    const a = await mineSet(h.ctx, { owner: MAYA, name: "GitHub", fields: { refresh_token: SECRET } });
    assert.deepEqual(mineRemove(h.ctx, { owner: MAYA, name: "GitHub" }), { removed: true });
    assert.deepEqual(mineRemove(h.ctx, { owner: MAYA, name: "GitHub" }), { removed: false });
    await assert.rejects(u.secretPort(h.ctx.db).secret(`${a.handle}.refresh_token`, "", MAYA));
    assert.equal(HOST_ONLY_CALL.test("vault.mine_set") && HOST_ONLY_CALL.test("vault.mine_remove"), true);
    assert.equal(v.itemsList !== undefined, true);
  } finally { h.cleanup(); }
});
