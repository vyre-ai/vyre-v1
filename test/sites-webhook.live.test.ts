// GitHub's webhook for a site, end to end on a booted daemon: the site is made and its webhook turned on through the gateway, then a delivery signed with the site's own secret is posted to the real edge route
// (POST /hooks/sites). A good one is taken and queues a preview; the same delivery again, an unsigned one, a wrong secret, a changed body and a repo this Space has no site for are all refused (400 or 401).
// The tick then runs the queued preview as the person who owns the site; this daemon has no sites runner, so it cannot build, the push is recorded as failed, the site says so, and GitHub's redelivery of the same
// delivery is taken again (the failed push gave its id back).
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { boot, call, hostLog, seededDir, waitFor } from "./support/live.ts";

const enc = new TextEncoder();
async function sign(secret: string, body: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `sha256=${Buffer.from(await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(body))).toString("hex")}`;
}

test("a site's GitHub webhook over the real edge route: signed deliveries are taken once, forged ones refused, a failed push is given back", async (t) => {
  const dir = seededDir();
  const d = await boot(dir, null);
  t.after(async () => {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const made = await call(d, "sites.create", {
    name: "Hooked app",
    source: { repo: "acme/app", branch: "main" },
    idempotencyKey: "hook-site-1",
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const siteId = made.data.site.siteId as string;
  const on = await call(d, "sites.webhook_set", { siteId, enabled: true, follow: ["feat/*"] });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const secret = on.data.secret as string;
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal((await call(d, "sites.webhook_get", { siteId })).data.secret, undefined, "shown once");

  const post = async (body: string, headers: Record<string, string>): Promise<{ status: number; text: string }> => {
    const r = await fetch(`${d.url}/hooks/sites`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8_000),
    });
    return { status: r.status, text: await r.text() };
  };
  const push = (branch: string, repo = "acme/app"): string =>
    JSON.stringify({
      ref: `refs/heads/${branch}`,
      after: "a".repeat(40),
      repository: { full_name: repo, default_branch: "main" },
    });
  const delivery = async (body: string, id: string, secretUsed = secret): Promise<{ status: number; text: string }> =>
    post(body, {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": id,
      "x-hub-signature-256": await sign(secretUsed, body),
    });

  const body = push("feat/e2e");
  const good = await delivery(body, "e2e00001-aaaa");
  assert.equal(good.status, 200, good.text);
  assert.deepEqual(JSON.parse(good.text), { accepted: true });

  // refused: the same delivery again (one that asked for nothing, so no failed push gave its id back), no signature, a wrong secret, a changed body, a repo with no site here
  const quiet = push("not-followed");
  assert.equal((await delivery(quiet, "e2e0000a-aaaa")).status, 200);
  assert.equal((await delivery(quiet, "e2e0000a-aaaa")).status, 400, "the same delivery again");
  assert.equal(
    (await post(body, { "x-github-event": "push", "x-github-delivery": "e2e00002-aaaa" })).status,
    401,
    "unsigned",
  );
  assert.equal((await delivery(push("feat/x"), "e2e00003-aaaa", "0".repeat(64))).status, 401, "wrong secret");
  const signedBody = push("feat/y");
  assert.equal(
    (
      await post(signedBody + " ", {
        "x-github-event": "push",
        "x-github-delivery": "e2e00004-aaaa",
        "x-hub-signature-256": await sign(secret, signedBody),
      })
    ).status,
    401,
    "a body changed after it was signed",
  );
  assert.equal(
    (await delivery(push("feat/z", "someone/else"), "e2e00005-aaaa")).status,
    401,
    "a repo with no site here",
  );
  // a GET is not a delivery
  assert.equal((await fetch(`${d.url}/hooks/sites`)).status, 405);

  // the tick runs the queued preview as the site's owner; there is no runner here, so it is recorded as failed
  const failed = await waitFor(
    async () => {
      const f = (await call(d, "sites.webhook_get", { siteId })).data.failed as {
        branch: string;
        action: string;
        error: string;
      }[];
      // the auto-deploy a push asked for may sit beside it (it shows on the card with its reason too): the push's own is the one asked about
      const mine = f.filter((x) => x.branch === "feat/e2e");
      return mine.length ? mine : null;
    },
    20_000,
    () => hostLog(d),
  );
  assert.equal(failed[0]!.branch, "feat/e2e");
  assert.ok(failed[0]!.error.length > 0);
  // a pull request closed from the site's own repo is taken (it asks for the preview of its branch to go); one from a fork is taken and asks for nothing
  const closed = (repo: string): string =>
    JSON.stringify({
      action: "closed",
      repository: { full_name: "acme/app", default_branch: "main" },
      pull_request: { head: { ref: "feat/e2e", repo: { full_name: repo } } },
    });
  const prDelivery = async (body: string, id: string): Promise<{ status: number; text: string }> =>
    post(body, {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": id,
      "x-hub-signature-256": await sign(secret, body),
    });
  assert.equal((await prDelivery(closed("stranger/app"), "e2e0000b-aaaa")).status, 200, "a fork's pull request");
  assert.equal((await prDelivery(closed("acme/app"), "e2e0000c-aaaa")).status, 200, "its own pull request");
  // and GitHub's redelivery of the same delivery is taken again
  const again = await delivery(body, "e2e00001-aaaa");
  assert.equal(again.status, 200, again.text);
});

test("on a booted daemon, a push to the production branch of a site that holds a Vault key is not parked unpinned: when the branch head cannot be read (no network here) the deploy is refused, nothing is held, and the site's card says why", async (t) => {
  const dir = seededDir();
  const d = await boot(dir, null);
  t.after(async () => {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const made = await call(d, "sites.create", {
    name: "Keyed app",
    source: { repo: "acme/keyed", branch: "main" },
    idempotencyKey: "hook-site-2",
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const siteId = made.data.site.siteId as string;
  const folder = await call(d, "vault.folders.create", {
    name: "Keys",
    scope: "shared",
    idempotencyKey: "keys-folder",
  });
  assert.equal(folder.status, 200, JSON.stringify(folder.data));
  const item = await call(d, "vault.item.put", {
    folderId: folder.data.folder.id,
    name: "Payments",
    kind: "other",
    fields: [{ key: "token", value: "sk_live_x", secret: true }],
    idempotencyKey: "keys-item",
  });
  assert.equal(item.status, 200, JSON.stringify(item.data));
  const set = await call(d, "sites.env_set", {
    siteId,
    entries: [{ name: "PAYMENTS", vaultHandle: item.data.item.handle }],
  });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal((await call(d, "sites.update", { siteId, autoDeploy: true })).status, 200);
  const on = await call(d, "sites.webhook_set", { siteId, enabled: true });
  const secret = on.data.secret as string;
  const body = JSON.stringify({
    ref: "refs/heads/main",
    after: "b".repeat(40),
    repository: { full_name: "acme/keyed", default_branch: "main" },
  });
  const r = await fetch(`${d.url}/hooks/sites`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": "keyed0001-aaaa",
      "x-hub-signature-256": await sign(secret, body),
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  assert.equal(r.status, 200);
  // the tick asks as the person who deployed last, with origin sites-push, and the real Gate and rule judge it; with no head to read the card cannot show what would deploy, so it is refused and never parked
  const failed = await waitFor(
    async () => {
      const f = (await call(d, "sites.webhook_get", { siteId })).data.failed as { action: string; error: string }[];
      const mine = f.filter((x) => x.action === "deploy");
      return mine.length ? mine : null;
    },
    30_000,
    () => hostLog(d),
  );
  assert.match(failed[0]!.error, /Couldn't read main to show what would deploy|Waiting for a person/);
  const tasks = await call(d, "tasks.list", { scope: "all", kinds: ["approve"], limit: 20 });
  assert.equal(tasks.status, 200, JSON.stringify(tasks.data).slice(0, 300));
  assert.doesNotMatch(
    JSON.stringify(tasks.data),
    /deploy Keyed app: anyone who can push to main can use Payments(?! at)/,
    "no card is parked unpinned",
  );
});
