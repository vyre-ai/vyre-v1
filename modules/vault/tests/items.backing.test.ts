// The Vault item behind a sealed record value is plumbing, not somebody's item (r40: ~110 items named like party.dob.rec_... cluttered one firm's shared Vault list). The server's Sealed fields folder
// and the items in it stay out of the list, the search, the counts and the folder list a person sees; the server still finds its folder, and a person with the right can still reveal a value; a
// Space that already had the folder gets it marked by the migration.
// @reads /modules/vault/handlers/items.ts
// @reads /modules/vault/migrations/0009_backing_folders.sql
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import { SEALED_FOLDER } from "../../../lib/company-keys.ts";
import { ADMIN, harness } from "../fixtures/harness.ts";
import { markBackingFolders } from "../projections.ts";

type Json = Record<string, unknown>;
let n = 0;
const idem = (): string => `bk-${++n}`;

async function sealedFolderAsServer(h: ReturnType<typeof harness>): Promise<string> {
  h.actAs("service", "svc_host");
  const f = (
    (await v.foldersCreate(h.ctx, { name: SEALED_FOLDER, scope: "shared", idempotencyKey: idem() })) as { folder: Json }
  ).folder;
  return String(f.id);
}
const put = async (h: ReturnType<typeof harness>, folderId: string, name: string): Promise<string> =>
  String(
    (
      (await v.itemPut(h.ctx, {
        folderId,
        name,
        kind: "other",
        fields: [{ key: "value", value: "1980-01-01", secret: true }],
        idempotencyKey: idem(),
      })) as { item: Json }
    ).item.id,
  );

test("items behind sealed record values are in no list, search or count a person sees, and the server still finds its folder", async () => {
  const h = harness();
  const sealed = await sealedFolderAsServer(h);
  const hidden = await put(h, sealed, "party.dob.rec_aaaa");
  h.actAs("person", ADMIN);
  const team = String(
    ((await v.foldersCreate(h.ctx, { name: "Team", scope: "shared", idempotencyKey: idem() })) as { folder: Json })
      .folder.id,
  );
  await put(h, team, "Stripe");
  const all = (await v.itemsList(h.ctx, {})) as { items: Json[]; total: number; counts: Json };
  assert.deepEqual(
    all.items.map((i) => i.name),
    ["Stripe"],
  );
  assert.equal(all.total, 1);
  assert.equal(all.counts["space"], 1);
  for (const q of ["party.dob", "rec_aaaa", "dob", SEALED_FOLDER]) {
    const found = (await v.itemsList(h.ctx, { q })) as { items: Json[] };
    assert.deepEqual(found.items, [], `search "${q}" finds nothing`);
  }
  assert.deepEqual(
    ((await v.foldersList(h.ctx, { scope: "shared" })) as { folders: Json[] }).folders.map((f) => f.name),
    ["Team"],
  );
  // the server still finds its folder, and the value is still read through the item id (the field's reference)
  h.actAs("service", "svc_host");
  assert.ok(
    ((await v.foldersList(h.ctx, { scope: "shared" })) as { folders: Json[] }).folders.some(
      (f) => f.name === SEALED_FOLDER,
    ),
  );
  h.actAs("person", ADMIN);
  h.grant(ADMIN, hidden, "view");
  h.allow(ADMIN, "vault.reveal");
  const shown = (await v.itemReveal(h.ctx, { itemId: hidden, fields: ["value"] })) as { fields: { value: string }[] };
  assert.equal(shown.fields[0]!.value, "1980-01-01");
  h.cleanup();
});

test("a person's own folder with that name is an ordinary folder", async () => {
  const h = harness();
  h.actAs("person", ADMIN);
  const mine = String(
    (
      (await v.foldersCreate(h.ctx, { name: SEALED_FOLDER, scope: "shared", idempotencyKey: idem() })) as {
        folder: Json;
      }
    ).folder.id,
  );
  await put(h, mine, "Kept");
  assert.deepEqual(
    ((await v.itemsList(h.ctx, {})) as { items: Json[] }).items.map((i) => i.name),
    ["Kept"],
  );
  h.cleanup();
});

test("a Space that already had a Sealed fields folder and items has them marked by the migration", async () => {
  const h = harness();
  const sealed = await sealedFolderAsServer(h);
  const item = await put(h, sealed, "party.ssn.rec_bbbb");
  h.grant(ADMIN, item, "view");
  // a Space from before this change: no marker, the folder just there
  h.ctx.db.run(`DELETE FROM vault_backing_folder WHERE "folderId" = ?`, sealed);
  h.actAs("person", ADMIN);
  assert.equal(((await v.itemsList(h.ctx, {})) as { items: Json[] }).items.length, 1, "unmarked, the item shows");
  markBackingFolders(h.ctx);
  assert.deepEqual(((await v.itemsList(h.ctx, {})) as { items: Json[] }).items, []);
  h.cleanup();
});
