// F47 follow-up (14 Nov 2026): a person's own connection belongs to that person. A member names another person's private connection in a step; does the save pass, and when the member presses Run, does the
// connector call go out carrying the other person's credential? Real daemon, a stand-in provider that records the credential each call carried.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { fakePlatform } from "../src/platform/index.ts";

test("a member names another person's private connection: save and run", async () => {
  const core = bootCore(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-person-conn-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const secret = `fixture-olivia-${crypto.randomUUID()}`;
  const carried: string[] = [];
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "https://configured.fixture.test"], {}, "1.2.3"),
    platform: fakePlatform(),
    vault: { secret: async () => secret, signRs256: async () => "" },
    connectorNetwork: {
      resolve: async () => ["203.0.113.9"],
      request: async (_url, options) => {
        carried.push(String(options.headers["X-Fixture-Key"]));
        return { status: 200, text: JSON.stringify({ ok: true }) };
      },
    },
    seams: {
      drivers: {
        setVaultKeyPort: () => ({ personKey: async (p: string) => (p === "usr_olivia" ? Buffer.alloc(32, 7) : null) }),
      },
    },
    session: (h) => {
      const t = String(h.authorization ?? "").replace(/^Bearer /, "");
      return {
        space: "spc_core",
        principal: { kind: "person", id: t === "owner" ? "usr_olivia" : "usr_noah" },
        device: "fixture",
      };
    },
    intervals: { fast: 3600000, slow: 3600000, encryption: 3600000, commands: 3600000, hooks: 200 },
  });
  const pump = setInterval(() => void d.hooks?.pump?.(), 150);
  const call = async (token: string, cap: string, input: object) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: `${cap}-${Math.random()}`, ...input }),
    });
    const text = await r.text();
    return { status: r.status, text, body: JSON.parse(text) as { data?: any; error?: any } };
  };
  try {
    assert.equal(
      (await call("owner", "connectors.init", { key: "fixture_api", title: "Fixture API", mode: "api" })).status,
      200,
    );
    const definition = {
      key: "fixture_api",
      title: "Fixture API",
      mode: "api",
      scope: "person",
      version: "1.0.0",
      auth: { type: "api_key", secret: "Fixture_Key", header: "X-Fixture-Key" },
      domains: ["api.fixture.test"],
      secrets: [{ name: "Fixture_Key", description: "Fixture key" }],
      actions: [{ name: "ping", url: "https://api.fixture.test/ping" }],
      health: "ping",
      tests: [],
    };
    const store = new DatabaseSync(path.join(dir, "space.db"));
    store
      .prepare("UPDATE cn_connectors SET def=?,state='live',version='1.0.0' WHERE key=?")
      .run(JSON.stringify(definition), "fixture_api");
    store.close();
    // a member who may run connectors at all (the reviewer's case): the Developer role carries connectors.manage
    assert.equal(
      (
        await call("owner", "access.roles.assign", {
          subject: { kind: "person", id: "usr_noah" },
          roleId: "rol_developer",
        })
      ).status,
      200,
    );
    const folder = await call("owner", "vault.folders.create", { name: "Keys", scope: "shared" });
    const item = await call("owner", "vault.item.put", {
      folderId: folder.body.data.folder.id,
      name: "Fixture Key",
      kind: "api_key",
      fields: [{ key: "key", value: secret, secret: true }],
    });
    const own = await call("owner", "connections.create", {
      connector: "fixture_api",
      title: "Olivia private",
      ownerKind: "person",
      secrets: { Fixture_Key: item.body.data.item.handle },
    });
    assert.equal(own.status, 200, own.text);
    const connectionId = own.body.data.connection.connectionId as string;
    assert.equal((await call("noah", "connections.get", { connectionId })).status, 404);
    const named = (token: string, key: string) =>
      call(token, "automations.create", {
        name: key,
        idempotencyKey: key,
        definition: {
          triggers: [{ key: "manual" }],
          nodes: [
            { id: "ask", key: "connector_request", input: { connector: "fixture_api", action: "ping", connectionId } },
          ],
        },
      });
    // the save agrees with the Run: another person's own connection cannot be named, the owner's can
    const refused = await named("noah", "Borrow");
    assert.equal(refused.status, 422, refused.text);
    assert.match(refused.text, /Authenticated request: you cannot use the connection it names/);
    assert.equal(refused.text.includes(connectionId), false, "no id in the words");
    const mine = await named("owner", "Mine");
    assert.equal(mine.status, 200, mine.text);
    // the owner's own run goes out with her credential; nothing ever went out carrying it for Noah
    const run = await call("owner", "automations.run", { automationId: mine.body.data.automation.id });
    assert.equal(run.status, 200, run.text);
    await new Promise((r) => setTimeout(r, 4000));
    assert.deepEqual(carried.length, 1, "only the owner's own run called the provider");
  } finally {
    clearInterval(pump);
    await d.stop();
  }
});
