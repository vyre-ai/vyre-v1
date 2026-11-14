// What an agent makes for a person is the person's (owner ruling, 14 Nov 2026): a Mine folder only for the person it works for in that call, and a shared folder or item owned by that person, never by the
// agent. Nobody else's Mine opens to it.
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import { AGENT, MAYA, ROB, SECRET, harness, refusedWith } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const ownerOf = (h: ReturnType<typeof harness>, table: string, id: string): string =>
  String(h.rows(`SELECT * FROM ${table} WHERE "id" = ?`, id)[0]?.["owner"]);

test("an agent working for a person may make a Mine folder for that person, owned by them; with nobody to work for, or for another, it may not", async () => {
  const h = harness();
  h.actAs("agent", AGENT);
  assert.equal(
    await refusedWith(v.foldersCreate(h.ctx, { name: "Mine", scope: "mine", idempotencyKey: "a0" })),
    "permission.no_grant",
    "no person behind the call: refused",
  );
  (h.ctx as { actingFor?: string }).actingFor = MAYA;
  const f = out(out(await v.foldersCreate(h.ctx, { name: "Mine", scope: "mine", idempotencyKey: "a1" })).folder);
  assert.equal(ownerOf(h, "vault_folder", String(f["id"])), MAYA, "owned by the person, never the agent");
  assert.equal(f["scope"], "mine");
  // it is Maya's: Rob's turn through the same agent does not reach it, and cannot be made into Rob's by naming it
  (h.ctx as { actingFor?: string }).actingFor = ROB;
  assert.equal(
    await refusedWith(
      v.foldersCreate(h.ctx, { name: "Inside", scope: "mine", parentId: String(f["id"]), idempotencyKey: "a2" }),
    ),
    "validation.not_found",
    "another person's Mine is not opened by the agent",
  );
});

test("a shared folder and a shared item an agent makes while working for a person are owned by that person", async () => {
  const h = harness();
  h.actAs("agent", AGENT);
  (h.ctx as { actingFor?: string }).actingFor = MAYA;
  const folder = out(
    out(await v.foldersCreate(h.ctx, { name: "Team keys", scope: "shared", idempotencyKey: "b1" })).folder,
  );
  assert.equal(ownerOf(h, "vault_folder", String(folder["id"])), MAYA);
  // what the agent made for Maya it works with through the access check (the registrar's made_by, which the vault handlers do not read), here a grant at Edit
  h.grant(AGENT, String(folder["id"]), "edit");
  const item = out(
    out(
      await v.itemPut(h.ctx, {
        folderId: String(folder["id"]),
        name: "Fathom",
        kind: "api_key",
        fields: [{ key: "api_key", value: SECRET }],
        idempotencyKey: "b2",
      } as Parameters<typeof v.itemPut>[1]),
    ).item,
  );
  assert.equal(ownerOf(h, "vault_meta", String(item["id"])), MAYA);
  // for nobody, the agent is still the owner of what it makes (a Space automation with no person behind it)
  delete (h.ctx as { actingFor?: string }).actingFor;
  const own = out(
    out(await v.foldersCreate(h.ctx, { name: "Agent only", scope: "shared", idempotencyKey: "b3" })).folder,
  );
  assert.equal(ownerOf(h, "vault_folder", String(own["id"])), AGENT);
});
