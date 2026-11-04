// Share a Vault item or folder through the one Access sheet: the Vault's three levels, the current access, a change and a removal through vault.share and vault.unshare, and nothing above the caller's own level.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { VaultDataProvider } from "../layout/data.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { VaultShareSheet } from "../share/VaultShareSheet.tsx";

async function open(mine: string, kind: "vault_item" | "vault_folder" = "vault_item") {
  const v = createSampleVault();
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    const out = await (v.data.call as (c: string, i: unknown) => Promise<unknown>)(cap, input);
    return cap === "access.shares_of" ? { ...(out as object), mine } : out;
  };
  const data = { ...v.data, call } as typeof v.data;
  const root = createRoot();
  await act(async () => { root.render(<VaultDataProvider value={data}><VaultShareSheet kind={kind} id="vit_ghl" name="GoHighLevel" onClose={() => undefined} /></VaultDataProvider>); });
  await flush();
  await flush();
  return { calls, tree: root.container as unknown as Parameters<typeof find>[0] };
}

test("the sheet lists the owner once and who holds the item, with the Vault's own level names", async () => {
  const restore = installDom();
  try {
    const s = await open("manage");
    const text = textOf(s.tree);
    for (const word of ["GoHighLevel", "Owner", "General access", "Maya", "Omar", "Can edit", "Can see"]) assert.ok(text.includes(word), word);
    assert.ok(!text.includes("never lowered"), "no legend");
  } finally { restore(); }
});

test("a level change is vault.share and a removal is vault.unshare, each once", async () => {
  const restore = installDom();
  try {
    const s = await open("manage");
    await press(find(s.tree, "as-acc-level-usr_omar"));
    await press(find(s.tree, "menu-item-Can manage"));
    await press(find(s.tree, "as-acc-level-usr_omar"));
    await press(find(s.tree, "menu-item-Remove access"));
    await flush();
    const writes = s.calls.filter((c) => c.cap.startsWith("vault."));
    assert.deepEqual(writes.map((c) => c.cap), ["vault.share", "vault.unshare"]);
    assert.deepEqual(writes[0]!.input, { resource: { type: "vault_item", id: "vit_ghl" }, subject: { kind: "person", id: "usr_omar" }, level: "manage" });
    assert.deepEqual(writes[1]!.input, { resource: { type: "vault_item", id: "vit_ghl" }, subject: { kind: "person", id: "usr_omar" } });
  } finally { restore(); }
});

test("someone who holds View is not offered Can manage, and the Vault offers three levels", async () => {
  const restore = installDom();
  try {
    const s = await open("view");
    await press(find(s.tree, "as-acc-level-usr_omar"));
    assert.ok(find(s.tree, "menu-item-Can manage") === null, "a person gives no more than they have");
    assert.ok(find(s.tree, "menu-item-Can edit") === null, "Can edit is not a Vault choice any more");
    assert.ok(find(s.tree, "menu-item-Can use without seeing") !== null);
  } finally { restore(); }
});
