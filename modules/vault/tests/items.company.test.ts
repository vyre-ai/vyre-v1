// Company keys protect themselves (vault audit, Broken 8): a Google delegation key, the Microsoft app's secret or a sign-in app's secret put in any shared folder (as the owner's agent does under
// the setup grant) is filed in the Restricted "Company connections" folder, so a member with Edit on the folder that was named can never reveal it. Nobody who may not set labels can add one.
// @reads /modules/vault/handlers/items.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import { COMPANY_FOLDER } from "../handlers/items.ts";
import { ADMIN, ROB, harness, refusedWith } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
let n = 0;
const idem = (): string => `co-${++n}`;
const DWD = '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----FAKE"}'; // secret-scan: fake

test("a company key named for a team folder lands in the Restricted Company connections folder; an ordinary key stays where it was put", async () => {
  const h = harness();
  h.actAs("person", ADMIN);
  const team = String(((await v.foldersCreate(h.ctx, { name: "Team keys", scope: "shared", idempotencyKey: idem() })) as { folder: Json }).folder.id);
  h.grant(ROB, team, "edit");
  for (const name of ["Google_DWD", "Microsoft App", "Sso_Google_Secret"]) {
    const put = ((await v.itemPut(h.ctx, { folderId: team, name, kind: "api_key", fields: [{ key: "key", value: DWD, secret: true }], idempotencyKey: idem() })) as { item: Json }).item;
    const folder = h.rows(`SELECT * FROM vault_folder WHERE "id" = ?`, String(put.folderId))[0]!;
    assert.equal(folder.name, COMPANY_FOLDER, name);
    assert.equal(h.labels.get(`vault_folder/${String(folder.id)}`), "restricted", `${name}: the folder is Restricted before the key goes in`);
  }
  assert.equal(h.rows(`SELECT * FROM vault_folder WHERE "name" = ?`, COMPANY_FOLDER).length, 1, "one Company connections folder");
  const plain = ((await v.itemPut(h.ctx, { folderId: team, name: "Stripe", kind: "api_key", fields: [{ key: "key", value: "sk_test_0000", secret: true }], idempotencyKey: idem() })) as { item: Json }).item; // secret-scan: fake
  assert.equal(plain.folderId, team);
  h.cleanup();
});

test("someone who may not set labels cannot add a company key at all: nothing is stored", async () => {
  const h = harness();
  h.actAs("person", ADMIN);
  const team = String(((await v.foldersCreate(h.ctx, { name: "Team keys", scope: "shared", idempotencyKey: idem() })) as { folder: Json }).folder.id);
  const call = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => { if (cap === "access.labels.set") throw new Error("permission.no_grant"); return call(cap, input); };
  assert.equal(await refusedWith(v.itemPut(h.ctx, { folderId: team, name: "Google_DWD", kind: "api_key", fields: [{ key: "key", value: DWD, secret: true }], idempotencyKey: idem() })), "validation.precondition_failed");
  assert.equal(h.rows(`SELECT * FROM vault_meta`).length, 0);
  h.cleanup();
});
