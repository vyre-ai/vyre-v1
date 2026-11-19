// search.key is a Vault handle: only one the person setting it may use, with a field that exists.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import type { SettingsCtx } from "../handlers/index.ts";
import { handlers } from "../impl.ts";

const setSpace = (ctx: SettingsCtx, value: unknown) =>
  (handlers as unknown as Record<string, (c: SettingsCtx, i: unknown) => Promise<unknown>>)["settings.set_space"]!(
    ctx,
    {
      key: "search.key",
      value,
    },
  );
const withVault = (h: ReturnType<typeof harness>, call: (cap: string, input: any) => Promise<unknown>): SettingsCtx =>
  ({ ...h.as("usr_dana", { admin: true }), call }) as unknown as SettingsCtx;

test("a handle the person may use, with a field that exists, is saved; the Vault is asked as them", async () => {
  const h = harness();
  const asked: unknown[] = [];
  const ctx = withVault(h, async (cap, input) => {
    asked.push([cap, input.item ?? input.itemId]);
    return cap === "vault.use"
      ? { handle: "#Brave_Search", itemId: "vit_1", fields: ["api_key"] }
      : { item: { id: "vit_1", kind: "api_key" } };
  });
  await setSpace(ctx, "#Brave_Search.api_key");
  assert.deepEqual(asked, [
    ["vault.use", "Brave_Search"],
    ["vault.item.get", "vit_1"],
  ]);
  await setSpace(ctx, "");
});

test("a Vault item the person may not use, a field it does not have, and something that is not a handle are refused, and nothing is saved", async () => {
  const h = harness();
  const denied = withVault(h, async () => {
    throw Object.assign(new Error("no"), { code: "permission.no_grant" });
  });
  await assert.rejects(
    () => setSpace(denied, "#Someone_Elses.api_key"),
    (e) => codeOf(e) === "validation.bad_input",
  );
  const noField = withVault(h, async (cap) => (cap === "vault.use" ? { itemId: "vit_1", fields: ["other"] } : { item: { kind: "api_key" } }));
  await assert.rejects(
    () => setSpace(noField, "#Brave_Search.api_key"),
    (e) => codeOf(e) === "validation.bad_input",
  );
  const wrongKind = withVault(h, async (cap) => (cap === "vault.use" ? { itemId: "vit_2", fields: ["password"] } : { item: { kind: "login" } }));
  await assert.rejects(() => setSpace(wrongKind, "#A_Login.password"), (e) => codeOf(e) === "validation.bad_input", "only an API key item");
  const any = withVault(h, async () => ({ fields: [] }));
  await assert.rejects(
    () => setSpace(any, "two words"),
    (e) => codeOf(e) === "validation.bad_input",
  );
  const get = (
    handlers as unknown as Record<string, (c: SettingsCtx, i: unknown) => Promise<{ row: { value: unknown } }>>
  )["settings.get"]!;
  assert.equal((await get(any, { key: "search.key" })).row.value, "", "still the default");
});
