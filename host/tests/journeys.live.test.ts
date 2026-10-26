// P-L6_20: journeys.create on a booted daemon. The Journey makes its record type through schema.apply, and the schema refuses a status field that names no stages
// ("field stage options must be an object"), so the type carries the Journey's stages. Everything goes through the gateway with a token (rule 27); a member without journeys.manage is refused.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const OLIVIA = "usr_olivia";   // the seeded owner
const SANA = "usr_sana";   // a member without journeys.manage
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-journeys-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(dir: string): Promise<Daemon> {
  let token = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "journeys-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      if (h["authorization"] !== `Bearer ${token}`) return null;
      return h["x-test-as"] === "member"
        ? { space: CORE_SPACE, principal: { kind: "person", id: SANA }, device: "test-device" }
        : { space: CORE_SPACE, principal: { kind: "person", id: OLIVIA }, device: "test-device" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, machine: 3_600_000 },
  });
  token = d.token;
  return d;
}

const post = (d: Daemon, cap: string, body: unknown, as?: "member"): Promise<Response> =>
  fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}`, ...(as ? { "x-test-as": as } : {}) }, body: JSON.stringify(body) });

test("journeys.create on a booted daemon makes the Journey and its record type with the Journey's stages; a member without journeys.manage is refused", async () => {
  const d = await boot(seededDir());
  try {
    const stages = [{ key: "intake", title: "Intake", order: 1, exit: { requireTasks: false }, tasks: [], automations: [] }, { key: "done", title: "Done", order: 2, exit: { requireTasks: false }, tasks: [], automations: [], final: true }];
    const made = await post(d, "journeys.create", { name: "Client onboarding", subjectType: "contact", stages, idempotencyKey: "jrn-live-1" });
    const body = (await made.json()) as { data?: { journey?: { journeyId?: string; recordType?: string } }; error?: unknown };
    assert.equal(made.status, 200, JSON.stringify(body));
    const recordType = body.data!.journey!.recordType!;
    assert.match(recordType, /^journey_/);

    const type = await post(d, "schema.types.get", { type: recordType });
    const detail = (await type.json()) as { data?: { type: { fields: { key: string; type: string; options?: { stages?: { key: string; title: string }[] } }[] } } };
    assert.equal(type.status, 200, JSON.stringify(detail));
    const stage = detail.data!.type.fields.find((f) => f.key === "stage")!;
    assert.deepEqual(stage.options?.stages, [{ key: "intake", title: "Intake" }, { key: "done", title: "Done" }], "the record type carries the Journey's stages");

    const dup = await post(d, "journeys.create", { name: "client onboarding", subjectType: "contact", idempotencyKey: "jrn-live-2" });
    assert.equal(dup.status, 409, "the same name twice is refused");

    const refused = await post(d, "journeys.create", { name: "Member's journey", subjectType: "contact", idempotencyKey: "jrn-live-3" }, "member");
    assert.equal(refused.status, 403, "a member without journeys.manage is refused");
  } finally { await d.stop(); }
});
