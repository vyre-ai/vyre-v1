// P-SEC_07: audit.export writes rows into a CSV, and the read filter cannot reach a file's contents. A row that names a resource goes in only on an explicit view allow for that resource;
// a deny or a hold leaves the row out; a context with no authorize refuses and saves nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const ADMIN = "usr_admin";
type Decide = (resource: { type: string; id: string | null }) => "allow" | "deny" | "hold";

async function world() {
  const h = harness();
  const put = async (action: string, resource?: { type: string; id: string }) => {
    h.advance(1000);
    await handlers["audit.append"](h.as(ADMIN), { action, class: "change", ...(resource ? { resource } : {}) });
  };
  await put("grant.created", { type: "folder", id: "fld_open" });
  await put("grant.created", { type: "folder", id: "fld_secret" });
  await put("vault.revealed", { type: "vault_item", id: "vlt_held" });
  await put("policy.changed");
  return h;
}

const ctxWith = (h: Harness, saved: string[], decide?: Decide) => ({
  ...h.as(ADMIN, { exports: { async save(_name: string, csv: string) { saved.push(csv); return "fil_exp1"; } } }),
  ...(decide ? { authorize: (_a: unknown, r: { type: string; id: string | null }) => ({ effect: decide(r), reason: "test", decisionId: "dec_t" }) } : {}),
}) as never;

test("audit.export: a row naming a resource the caller cannot view is absent from the file; a hold is a deny; rows with no resource stay", async () => {
  const h = await world();
  const saved: string[] = [];
  const out = await handlers["audit.export"](ctxWith(h, saved, (r) => (r.id === "fld_secret" ? "deny" : r.id === "vlt_held" ? "hold" : "allow")), {});
  assert.equal(out.rows, 2);
  const csv = saved[0]!;
  assert.ok(csv.includes("folder:fld_open") && csv.includes("policy.changed"));
  assert.ok(!csv.includes("fld_secret"), "the restricted resource is not named in the file");
  assert.ok(!csv.includes("vlt_held"), "a hold is a deny");
});

test("audit.export: a context with no authorize refuses and saves nothing (fail closed)", async () => {
  const h = await world();
  const saved: string[] = [];
  await assert.rejects(handlers["audit.export"](ctxWith(h, saved), {}), (e) => codeOf(e) === "permission.role_lacks_permission");
  assert.deepEqual(saved, []);
});
