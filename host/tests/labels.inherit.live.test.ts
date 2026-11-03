// A Restricted folder covers what is in it, through the real daemon (lane l-labelinherit; docs/notes/restricted-label-inheritance.md). Found by the member first-hour walk on 3 Nov: an owner labelled a
// Shared Vault folder Restricted, added an item from the Vault, and every Member could list it, because authorize read only the item's own label. Here, over HTTP with the seeded core Space
// (Olivia the Owner, cleared for Restricted; Noah a Member, cleared for Internal, with Edit on the Space):
//   Vault: an item put into a Restricted folder, a folder labelled after its items exist, an item moved in, an item in a subfolder;
//   Files: a file in a subfolder of a Restricted folder, a file moved in; files.get reports the label the file inherits;
//   public links (lead ruling 3 Nov): none is made for anything Restricted by its own label or a folder's, through access.share, vault.share or files.share_external.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { fakePlatform } from "../src/platform/index.ts";

type Json = { data?: any; error?: { code?: string; message?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const PEOPLE: Record<string, string> = { owner: "usr_olivia", member: "usr_noah" };

test("a Restricted folder covers its items, subfolders and what is moved in, in the Vault and in Files; no public link is made inside one", async () => {
  const core = bootCore(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-label-inherit-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "https://team.fixture.test"], {}, "1.2.3"),
    platform: fakePlatform(),
    vault: { secret: async () => "fixture-space-vault-secret", signRs256: async () => "" },
    seams: { drivers: { setVaultKeyPort: () => ({ personKey: async (person: string) => (person in { usr_olivia: 1, usr_noah: 1 } ? Buffer.alloc(32, person === "usr_olivia" ? 7 : 9) : null) }) } },
    session: (headers) => {
      const who = PEOPLE[String(headers["authorization"] ?? "").replace(/^Bearer /, "")];
      return who ? { space: CORE_SPACE, principal: { kind: "person", id: who }, device: "fixture" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const call = async (who: "owner" | "member", cap: string, input: object): Promise<{ status: number; body: Json }> => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${who}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(8_000) });
    return { status: r.status, body: await r.json() as Json };
  };
  const ok = async (who: "owner" | "member", cap: string, input: object): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await call(who, cap, input);
    assert.equal(r.status, 200, `${who} ${cap}: ${JSON.stringify(r.body)}`);
    return r.body.data;
  };
  let n = 0;
  const key = (): string => `label-inherit-${++n}`;
  const folder = async (name: string, parentId?: string): Promise<string> => (await ok("owner", "vault.folders.create", { name, scope: "shared", ...(parentId ? { parentId } : {}), idempotencyKey: key() })).folder.id;
  const item = async (folderId: string, name: string): Promise<string> => (await ok("owner", "vault.item.put", { folderId, name, kind: "api_key", fields: [{ key: "api_key", value: `FAKE-${name}-0123456789`, secret: true }], idempotencyKey: key() })).item.id;   // secret-scan: fake
  const restrict = async (type: string, id: string): Promise<void> => { await ok("owner", "access.labels.set", { resource: { type, id }, label: "restricted" }); };
  const listed = async (who: "owner" | "member"): Promise<string[]> => ((await ok(who, "vault.items.list", {})).items as Array<{ name: string }>).map((i) => i.name).sort();
  try {
    // ---- Vault
    const partners = await folder("Partners");
    await restrict("vault_folder", partners);
    const bank = await item(partners, "Partners_Bank");   // the Vault's Add sheet never labels the item: it is born public
    const team = await folder("Team");
    await item(team, "Team_Key");
    const open = await folder("Open");
    const moved = await item(open, "Open_Key");
    const deals = await folder("Deals", partners);
    await item(deals, "Deals_Key");
    assert.deepEqual(await listed("member"), ["Open_Key", "Team_Key"], "nothing in Partners or its subfolder is listed for a Member");
    assert.notEqual((await call("member", "vault.item.get", { itemId: bank })).status, 200, "nor read");
    assert.deepEqual(await listed("owner"), ["Deals_Key", "Open_Key", "Partners_Bank", "Team_Key"], "the Owner is cleared for all of it");

    await restrict("vault_folder", team);
    assert.deepEqual(await listed("member"), ["Open_Key"], "labelling a folder after its items exist reaches them");

    await ok("owner", "vault.item.move", { itemId: moved, folderId: partners });
    assert.deepEqual(await listed("member"), [], "an item moved into a Restricted folder is closed at once");
    assert.notEqual((await call("member", "vault.item.get", { itemId: moved })).status, 200);
    assert.equal((await ok("owner", "vault.item.get", { itemId: moved })).item.name, "Open_Key");

    // ---- Files
    const roots = (await ok("owner", "files.tree", {})).roots as Array<{ key: string; folderId?: string }>;
    const shared = roots.find((r) => r.key === "shared_knowledge")?.folderId;
    assert.ok(shared, JSON.stringify(roots));
    const hr = (await ok("owner", "files.folder.create", { parentId: shared, name: "HR", idempotencyKey: key() })).folder.folderId as string;
    await ok("owner", "files.folder.settings", { folderId: hr, label: "restricted" });
    const pay = (await ok("owner", "files.folder.create", { parentId: hr, name: "Pay", idempotencyKey: key() })).folder.folderId as string;
    const payroll = (await ok("owner", "files.create", { folderId: pay, name: "payroll.txt", content: { text: "salaries" }, idempotencyKey: key() })).file.fileId as string;
    const menu = (await ok("owner", "files.create", { folderId: shared, name: "menu.txt", content: { text: "lunch" }, idempotencyKey: key() })).file.fileId as string;
    assert.notEqual((await call("member", "files.get", { fileId: payroll })).status, 200, "a Member cannot read a file in a subfolder of a Restricted folder");
    const names = ((await ok("member", "files.list", { folder: shared })).files as Array<{ name: string }>).map((f) => f.name);
    assert.deepEqual(names, ["menu.txt"]);
    assert.equal((await ok("owner", "files.get", { fileId: payroll })).file.label, 3, "files.get reports the label the file inherits");
    assert.equal((await ok("member", "files.get", { fileId: menu })).file.label, 0);

    await ok("owner", "files.move", { fileId: menu, toFolderId: pay });
    assert.notEqual((await call("member", "files.get", { fileId: menu })).status, 200, "a file moved into a Restricted folder is closed at once");

    // ---- public links (lead ruling 3 Nov): refused for anything Restricted by its own label or a folder above it
    const token = "a1b2c3d4e5f60718a1b2";
    const viaVault = await call("owner", "vault.share", { resource: { type: "vault_item", id: bank }, subject: { kind: "link", id: token }, level: "view", idempotencyKey: key() });
    assert.equal(viaVault.status, 422, JSON.stringify(viaVault.body));
    assert.equal(viaVault.body.error?.code, "validation.precondition_failed");
    const viaAccess = await call("owner", "access.share", { resource: { type: "file", id: payroll }, subject: { kind: "link", id: token }, level: "view", idempotencyKey: key() });
    assert.equal(viaAccess.body.error?.code, "validation.precondition_failed", JSON.stringify(viaAccess.body));
    const outside = await call("owner", "files.share_external", { fileId: payroll, idempotencyKey: key() });
    assert.equal(outside.body.error?.code, "permission.above_clearance", JSON.stringify(outside.body));
    // outside a Restricted folder the Owner still makes both
    const free = (await ok("owner", "files.create", { folderId: shared, name: "notes.txt", content: { text: "open" }, idempotencyKey: key() })).file.fileId as string;
    await ok("owner", "files.share_external", { fileId: free, idempotencyKey: key() });
    await ok("owner", "access.share", { resource: { type: "file", id: free }, subject: { kind: "link", id: token }, level: "view", idempotencyKey: key() });
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
