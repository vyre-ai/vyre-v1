// Saving a Vault item offers a connector setup once. Declining that item is final. The key is not in the offer.
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
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const SECRET = "sk_live_SECRET";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-offer-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "exec-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  seams: { vaultSinks: { env: () => undefined } },
  session: (h) => {
    const token = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return token === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "exec-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
} satisfies DaemonOptions);

async function post(d: Daemon, route: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> {
  const response = await fetch(`${d.url}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: response.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
}

async function offers(d: Daemon): Promise<{ itemId: string; appName: string; text: string }[]> {
  const reply = await post(d, "/v1/automations/connector_offers", {});
  assert.equal(reply.status, 200, reply.text);
  assert.equal(reply.text.includes(SECRET), false, reply.text);
  return (reply.data["offers"] as { itemId: string; appName: string; text: string }[] | undefined) ?? [];
}

async function untilOffer(d: Daemon, appName: string): Promise<{ itemId: string; appName: string; text: string }> {
  const end = Date.now() + 5_000;
  for (;;) {
    const found = (await offers(d)).find((offer) => offer.appName === appName);
    if (found) return found;
    assert.ok(Date.now() < end, `no offer for ${appName}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

test("saving a Vault item offers a connector setup once, and declining is final", async () => {
  const dir = seededDir();
  const daemon = await boot(dir);
  try {
    const folder = await post(daemon, "/v1/vault/folders/create", { name: "Keys", scope: "shared", idempotencyKey: "offer-folder" });
    assert.equal(folder.status, 200, folder.text);
    const folderId = String((folder.data["folder"] as { id?: string } | undefined)?.id ?? "");
    assert.match(folderId, /^vfd_/);
    const put = await post(daemon, "/v1/vault/item/put", {
      folderId, name: "Stripe", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "offer-stripe",
    });
    assert.equal(put.status, 200, put.text);
    const stripe = await untilOffer(daemon, "Stripe");
    assert.equal(stripe.text, "Set up Stripe for Automations?");
    assert.equal((await offers(daemon)).filter((offer) => offer.itemId === stripe.itemId).length, 1);

    const declined = await post(daemon, "/v1/automations/connector_offer/decline", { itemId: stripe.itemId });
    assert.equal(declined.status, 200, declined.text);
    assert.equal(declined.data["decision"], "declined");
    assert.equal((await offers(daemon)).some((offer) => offer.itemId === stripe.itemId), false);
    const declinedAgain = await post(daemon, "/v1/automations/connector_offer/decline", { itemId: stripe.itemId });
    assert.equal(declinedAgain.data["decision"], "declined");

    const second = await post(daemon, "/v1/vault/item/put", {
      folderId, name: "Notion", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "offer-notion",
    });
    assert.equal(second.status, 200, second.text);
    const notion = await untilOffer(daemon, "Notion");
    assert.equal(notion.text, "Set up Notion for Automations?");
    assert.equal((await offers(daemon)).some((offer) => offer.itemId === stripe.itemId), false);
  } finally {
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
