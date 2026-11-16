// @tsx
// A Vault sidebar row as an address, so a tab can open on it (lane r32-nav, Open in New Tab).
import test from "node:test";
import assert from "node:assert/strict";
import { selectionArgs, selectionOfArgs } from "./model.ts";
import type { Selection } from "./model.ts";
import { vaultRoute } from "../../../shell/providers/vault.tsx";
import { formatHash, parseHash } from "../../../shell/hash/hash.ts";

test("every kind of row and every folder round-trips through its address", () => {
  const rows: Selection[] = [
    { kind: "all" },
    { kind: "providers" },
    { kind: "logins" },
    { kind: "keys" },
    { kind: "cards" },
    { kind: "health" },
    { kind: "mine" },
    { kind: "folder", folderId: "fld_abc12345" },
  ];
  for (const r of rows) assert.deepEqual(selectionOfArgs(selectionArgs(r)), r);
});

test("an address that names no row names none", () => {
  assert.equal(selectionOfArgs({}), undefined);
  assert.equal(selectionOfArgs({ select: "nonsense" }), undefined);
});

test("the Vault route reads the row an address names", () => {
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { select: "keys" } } as never), {
    surface: "layout",
    select: { kind: "keys" },
  });
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: {} } as never), { surface: "layout" });
});

test("the address a phone row opens reads back as that row (through the hash the shell writes)", () => {
  const hash = formatHash({ screen: "vault.layout", args: selectionArgs({ kind: "logins" }) });
  assert.deepEqual(vaultRoute(parseHash(hash)), { surface: "layout", select: { kind: "logins" } });
});
