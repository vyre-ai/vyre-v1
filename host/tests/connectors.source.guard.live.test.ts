// The Files mutation guard on a booted daemon, through HTTP: an ordinary Member inherits Space edit on Shared knowledge but may not change a connector's source, its subtree or the folders above it;
// the Owner (who may edit the connector) can; and what is not a source is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { fakePlatform } from "../src/platform/index.ts";

test("connector source folders: a Member cannot change the source, its subtree or its ancestors; the Owner can", async () => {
  const core = bootCore(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connector-guard-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE"); fs.copyFileSync(core.file, path.join(dir, "events.db")); core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), platform: fakePlatform(),
    session: (headers) => ({ space: CORE_SPACE, principal: { kind: "person", id: headers.authorization === "Bearer owner" ? "usr_olivia" : "usr_noah" }, device: "fixture" }),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const call = async (token: string, cap: string, input: object): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input) });
    return { status: r.status, body: await r.json() };
  };
  const ok = async (cap: string, input: object): Promise<any> => { const r = await call("owner", cap, input); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.body)}`); return r.body.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = 0; const key = (): string => `guard-${++n}`;
  try {
    const init = await ok("connectors.init", { key: "guarded", title: "Guarded", mode: "webhook_only", idempotencyKey: key() });
    const source: string = init.folderId;
    const folder = (await ok("files.folder.get", { folderId: source })).folder;
    const connectors: string = folder.parentId;
    const actions: string = (await ok("files.folder.create", { parentId: source, name: "actions", idempotencyKey: key() })).folder.folderId;
    const main = (await ok("files.list", { folder: source })).files.find((f: { name: string }) => f.name === "connector.toml");
    const action = (await ok("files.create", { folderId: actions, name: "ping.json", content: { text: "{}" }, idempotencyKey: key() })).file;
    const outside = (await ok("files.create", { folderId: connectors, name: "notes.txt", content: { text: "ordinary" }, idempotencyKey: key() })).file;

    // the Member can read the source but every mutation of it, its subtree and the folders above it is refused, and nothing changed
    assert.equal((await call("member", "files.read", { fileId: main.fileId })).status, 200);
    const refused: [string, object][] = [
      ["files.write", { fileId: main.fileId, baseVersion: main.version, content: { text: "member" }, idempotencyKey: key() }],
      ["files.write", { fileId: action.fileId, content: { text: "member" }, idempotencyKey: key() }],
      ["files.create", { folderId: source, name: "x.json", content: { text: "{}" }, idempotencyKey: key() }],
      ["files.create", { folderId: actions, name: "x.json", content: { text: "{}" }, idempotencyKey: key() }],
      ["files.rename", { fileId: action.fileId, name: "renamed.json" }],
      ["files.delete", { fileId: action.fileId }],
      ["files.move", { fileId: outside.fileId, toFolderId: actions }],
      ["files.move", { fileId: action.fileId, toFolderId: connectors }],
      ["files.folder.create", { parentId: source, name: "sub", idempotencyKey: key() }],
      ["files.folder.rename", { folderId: actions, name: "acts" }],
      ["files.folder.settings", { folderId: source, reviewChanges: false }],
      ["files.folder.delete", { folderId: source }],
      ["files.folder.move", { folderId: source, toParentId: connectors }],
      ["files.folder.rename", { folderId: connectors, name: "renamed-parent" }],
      ["files.folder.delete", { folderId: connectors }],
    ];
    for (const [cap, input] of refused) {
      const r = await call("member", cap, input);
      assert.equal(r.status, 403, `${cap} ${JSON.stringify(input)} must be refused for a Member: ${JSON.stringify(r.body)}`);
    }
    assert.equal((await ok("files.folder.get", { folderId: source })).folder.reviewChanges, true, "Review changes is still on");
    assert.equal((await ok("files.get", { fileId: action.fileId })).file.name, "ping.json");
    assert.equal((await ok("files.folder.get", { folderId: connectors })).folder.name, "connectors");

    // what is not a source is an ordinary Space folder: the Member's normal Files access applies
    const mine = await call("member", "files.write", { fileId: outside.fileId, content: { text: "member edit" }, idempotencyKey: key() });
    assert.equal(mine.status, 200, `a file beside the source is ordinary: ${JSON.stringify(mine.body)}`);

    // the Owner can edit the connector, so the same structural and content changes pass
    assert.equal((await call("owner", "files.write", { fileId: action.fileId, content: { text: "{\"edited\":true}" }, idempotencyKey: key() })).status, 200);
    assert.equal((await call("owner", "files.folder.rename", { folderId: actions, name: "acts" })).status, 200);
    assert.equal((await call("owner", "files.folder.rename", { folderId: actions, name: "actions" })).status, 200);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
