// A setup is offered only when the person's own assistant can finish it (owner, 13 Nov 2026: "its beyond the scope of my assistant so then dont show that to me"). The daemon, the access rules, the
// agents and the Vault are real; there is no model. An admin is offered an item the assistant may use (and told that pressing Set up allows it to build connectors); never a Restricted item or a
// company key. A member is offered nothing: neither they nor their assistant may build connectors. After the admin allows the assistant, the offer no longer carries that line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const SECRET = "plain-fake-value";
const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};
const PASSWORD = "correct horse battery staple 9";
type Json = { data?: any; error?: { code?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Offer = { itemId: string; appName: string; text: string };

test("the first page offers a setup only when the person's assistant can finish it", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-offer-reach-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d: Daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "offer-reach",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200 },
  });
  const pump = setInterval(() => void d.hooks?.pump?.(), 150);
  const post = async (
    token: string,
    p: string,
    body: unknown,
  ): Promise<{ status: number; body: Json; text: string }> => {
    const r = await fetch(`${d.url}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? (JSON.parse(text) as Json) : {}, text };
  };
  const joinAs = async (name: string, role: string): Promise<{ id: string; token: string }> => {
    const invite = await post(d.token, "/v1/members/invites/create", { role, idempotencyKey: `reach-invite-${name}` });
    assert.equal(invite.status, 200, invite.text);
    const code = decodeURIComponent(new URL(invite.body.data.link as string).pathname.split("/").pop() ?? "");
    const r = await fetch(`${d.url}/v1/members/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        username: name,
        password: PASSWORD,
        deviceName: "Mac",
        deviceClass: "desktop",
        keys: KEYS,
      }),
    });
    const body = (await r.json()) as Json;
    assert.equal(r.status, 200, JSON.stringify(body));
    return { id: body.data.personId as string, token: body.data.token as string };
  };
  const offersFor = async (token: string): Promise<Offer[]> => {
    const reply = await post(token, "/v1/automations/connector_offers", {});
    assert.equal(reply.status, 200, reply.text);
    assert.equal(reply.text.includes(SECRET), false, reply.text);
    return (reply.body.data.offers as Offer[] | undefined) ?? [];
  };
  const until = async <T>(what: string, look: () => Promise<T | undefined>): Promise<T> => {
    const end = Date.now() + 20_000;
    for (;;) {
      const v = await look();
      if (v !== undefined) return v;
      assert.ok(Date.now() < end, `gave up waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  try {
    const ada = await joinAs("ada", "rol_admin");
    const mel = await joinAs("mel", "rol_member");
    const folder = await post(ada.token, "/v1/vault/folders/create", {
      name: "Keys",
      scope: "shared",
      idempotencyKey: "reach-folder",
    });
    assert.equal(folder.status, 200, folder.text);
    const folderId = String(folder.body.data.folder.id);
    const ids: Record<string, string> = {};
    for (const name of ["Acme", "Zeta", "Google_DWD"]) {
      const put = await post(ada.token, "/v1/vault/item/put", {
        folderId,
        name,
        kind: "api_key",
        fields: [{ key: "api_key", value: SECRET }],
        idempotencyKey: `reach-${name}`,
      });
      assert.equal(put.status, 200, put.text);
      ids[name] = String(put.body.data.item.id);
    }
    // Zeta is labelled Restricted: above every assistant's clearance
    const label = await post(ada.token, "/v1/access/labels/set", {
      resource: { type: "vault_item", id: ids["Zeta"] },
      label: "restricted",
    });
    assert.equal(label.status, 200, label.text);

    // the admin: Acme, with the one thing pressing Set up also does; never Zeta (Restricted) and never Google_DWD (a company key)
    const seen = await until("the admin's offer for Acme", async () => {
      const found = await offersFor(ada.token);
      return found.some((o) => o.appName === "Acme") ? found : undefined;
    });
    assert.deepEqual(seen.map((o) => o.appName).sort(), ["Acme"], JSON.stringify(seen));
    assert.match(seen[0]!.text, /Set up Acme for Automations\? Your assistant will be allowed to build connectors\./);

    // a member: nothing. Neither they nor their assistant may build connectors, so no setup is theirs to finish
    assert.deepEqual(await offersFor(mel.token), []);

    // the admin allows the assistant (the Vault's Allow): the offer is then just the question
    const mine = await until("the admin's assistant", async () => {
      const r = await post(ada.token, "/v1/agents/assistant_of", { personId: ada.id });
      return typeof r.body.data.agentId === "string" ? r : undefined;
    });
    const agentId = String(mine.body.data.agentId);
    const status = async (name: string): Promise<unknown> =>
      (await post(ada.token, "/v1/access/connector_builder/status", { agentId, itemId: ids[name] })).body.data;
    assert.deepEqual(await status("Acme"), { allowed: false, canGrant: true, reaches: true });
    const grant = await post(ada.token, "/v1/access/connector_builder/grant", { agentId });
    assert.equal(grant.status, 200, grant.text);
    assert.deepEqual(
      (await offersFor(ada.token)).map((o) => [o.appName, o.text]),
      [["Acme", "Set up Acme for Automations?"]],
    );
    assert.deepEqual(await status("Acme"), { allowed: true, canGrant: true, reaches: true });
    assert.deepEqual(await status("Zeta"), { allowed: true, canGrant: true, reaches: false });
  } finally {
    clearInterval(pump);
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
