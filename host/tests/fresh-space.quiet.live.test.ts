// The class guard: a brand-new Space (Personal and Team), made and claimed the normal way, with the boot sweeps and every first-run consumer let to settle, holds nothing for its owner: Needs you is empty,
// its count is zero, and no task of any kind exists. Any lane that files a task into a fresh Space (a folder that could not follow its record, a setup nag, a seed side effect) fails here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};
const PASSWORD = "correct horse battery staple 9";
type Json = { data?: any; error?: { code?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any

for (const kind of ["personal", "team"] as const) {
  test(`a fresh ${kind} Space, claimed and settled, holds nothing for its owner: no Needs-you item, a zero count, no task at all`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-quiet-${kind}-`));
    const d: Daemon = await startDaemon({
      config: loadConfig(
        [
          "--data-dir",
          dir,
          "--port",
          "0",
          "--space",
          `spc_quiet_${kind}`,
          "--space-name",
          `Quiet ${kind}`,
          "--space-kind",
          kind,
          "--address",
          "team.example.com",
        ],
        {},
        "1.2.3",
      ),
      platform: fakePlatform({
        os: "linux",
        hostname: `quiet-${kind}`,
        free: 80e9,
        commands: {
          [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
          "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
          "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
        },
      }),
      fetch: caddyFetch,
      // the sweeps and consumers run on short timers here, so the first run settles inside the test
      intervals: { fast: 250, slow: 500, encryption: 3_600_000, commands: 3_600_000, hooks: 250 },
    });
    const post = async (token: string | null, p: string, body: unknown): Promise<{ status: number; body: Json }> => {
      const r = await fetch(`${d.url}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      return { status: r.status, body: text ? (JSON.parse(text) as Json) : {} };
    };
    try {
      assert.ok(d.claim, "a fresh Space prints a claim link");
      const code = decodeURIComponent(new URL(d.claim.url).pathname.split("/").pop() ?? "");
      const claimed = await post(null, "/v1/identity/claim_owner", {
        code,
        spaceId: `spc_quiet_${kind}`,
        username: "olivia",
        displayName: "Olivia",
        password: PASSWORD,
        deviceName: "Mac",
        deviceClass: "desktop",
        keys: KEYS,
      });
      assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
      const signedIn = await post(null, "/v1/identity/sign_in", {
        username: "olivia",
        password: PASSWORD,
        deviceName: "Laptop",
        deviceClass: "desktop",
      });
      assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
      const owner = signedIn.body.data.session.token as string;
      // what a first hour makes: a project (its record, channel and Files folder), the way the Records page does, so the folder and its follow run through the consumers of the first run
      const described = await post(owner, "/v1/schema/describe", {});
      const projectType = (
        described.body.data?.types as { name?: string; key?: string; template?: string }[] | undefined
      )?.find((t) => t.template === "project");
      assert.ok(projectType, `${kind}: the Space has a project type to make a project from`);
      const made = await post(owner, "/v1/projects/create", {
        type: projectType.name ?? projectType.key,
        title: "First project",
        idempotencyKey: `quiet-${kind}-project`,
      });
      assert.equal(made.status, 200, JSON.stringify(made.body));
      // the first run's own work: every consumer and sweep the daemon has queued runs, several times over, with a moment between
      for (let i = 0; i < 6; i++) {
        await d.hooks?.pump?.();
        await new Promise((r) => setTimeout(r, 250));
      }
      const needs = await post(owner, "/v1/tasks/needs_you", {});
      assert.equal(needs.status, 200, JSON.stringify(needs.body));
      assert.deepEqual(
        (needs.body.data.items as { task: { title: string } }[]).map((i) => i.task.title),
        [],
        `${kind}: Needs you is empty`,
      );
      assert.equal(needs.body.data.total, 0);
      const count = await post(owner, "/v1/tasks/count_needs_you", {});
      assert.equal(count.body.data.count, 0, `${kind}: the badge count is zero`);
      const all = await post(owner, "/v1/tasks/list", { scope: "all" });
      assert.equal(all.status, 200, JSON.stringify(all.body));
      assert.deepEqual(
        ((all.body.data.tasks ?? all.body.data.items ?? []) as { title: string }[]).map((t) => t.title),
        [],
        `${kind}: no task of any kind exists`,
      );
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
