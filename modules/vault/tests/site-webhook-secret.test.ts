// A site's webhook secret lives in a Vault folder and item made for that site alone (modules/sites/handlers/hook.ts keepSecret), shared at View with the site's owner and the person the agent works for, and with nobody else. Here the Vault's own
// handlers answer who can read and use it: the two people can, a member with no grant cannot (not even to tell it exists), and an agent working for that member cannot either. (The harness carries the grants the shares make as levels; the
// access module's own sharing is tested there.)
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import { ADMIN, AGENT, MAYA, ROB, SECRET, harness, refusedWith } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;

test("the site's webhook secret can be read by the site's owner and the person the agent works for, and by nobody else", async () => {
  const h = harness();
  // the folder and the item are made for the one site (the owner is Maya here)
  const folderId = String(
    out(
      out(await v.foldersCreate(h.ctx, { name: "Webhook secret sit_1", scope: "shared", idempotencyKey: "f-site-1" }))
        .folder,
    ).id,
  );
  const made = out(
    await v.itemPut(h.ctx, {
      folderId,
      name: "Dash webhook secret",
      kind: "other",
      fields: [{ key: "secret", value: SECRET, secret: true }],
      idempotencyKey: "i-site-1",
    } as Parameters<typeof v.itemPut>[1]),
  );
  const itemId = String(out(made.item).id);
  // the shares at View: the person the agent works for (Admin here) and the owner
  h.grant(ADMIN, itemId, "view");
  h.grant(MAYA, itemId, "manage");
  // reading a shared value out also needs the role's Reveal permission: the owner and an admin have it, an ordinary member does not
  h.allow(MAYA, "vault.reveal");
  h.allow(ADMIN, "vault.reveal");
  // the owner reads it
  const own = out(await v.itemReveal(h.ctx, { itemId }));
  assert.ok(JSON.stringify(own).includes(SECRET), "the owner can read it to give GitHub");
  // the person the agent works for reads it
  h.actAs("person", ADMIN);
  const person = out(await v.itemReveal(h.ctx, { itemId }));
  assert.ok(JSON.stringify(person).includes(SECRET), "and so can the person it works for");
  // a member with no grant: neither read, nor use, nor even a hint it exists
  h.actAs("person", ROB);
  assert.equal(await refusedWith(v.itemReveal(h.ctx, { itemId })), "permission.no_grant");
  assert.equal(await refusedWith(v.itemGet(h.ctx, { itemId })), "permission.no_grant");
  assert.equal(await refusedWith(u.use(h.ctx, { item: "Dash webhook secret" })), "validation.not_found");
  // an agent working for that member has the member's access and no more: it cannot use or read it
  h.actAs("agent", AGENT);
  (h.ctx as { actingFor?: string }).actingFor = ROB;
  assert.equal(await refusedWith(u.use(h.ctx, { item: "Dash webhook secret" })), "validation.not_found");
  assert.equal(await refusedWith(v.itemReveal(h.ctx, { itemId })), "permission.no_grant");
  // and the secret is nowhere the module wrote down
  assert.ok(!h.everything().includes(SECRET));
  h.cleanup();
});
