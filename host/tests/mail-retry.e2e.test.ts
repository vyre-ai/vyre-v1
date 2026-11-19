// Mail retries, end to end on a booted daemon (lane r42-email-in): a message is sent through the real pipeline and the recorded Resend, the provider reports a soft bounce,
// the host's own schedule fires the retry as the host service (never as the person who sent), and the message is delivered exactly once.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { ROLE_PERMS } from "../../kernel/src/grants/roles.ts";
import type { FetchLike } from "../src/ctx/http.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  // the seed's owner role predates the comms permissions: give it the one the domain and route calls need
  const [stored] = core.store.appendBatch([
    {
      id: "evt_mailprov_0001",
      type: "role.defined",
      sv: 1,
      trace_id: "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
      actor: "svc_seed",
      vis: "space",
      entity: "role",
      entity_id: "owner",
      payload: { id: "owner", clearance: 3, perms: [...ROLE_PERMS["owner"], "comms.domains", "comms.shared_send"], name: "owner" },
    },
  ]);
  assert.ok(stored?.ok, "the role event is accepted");
  const dir = tmp("vyre-mailprov-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
function machine(dir: string) {
  return fakePlatform({
    os: "linux",
    hostname: "mailprov-test",
    free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  });
}
const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}
/** The two providers as recorded: what each endpoint answers. Anything else is a 404. */
function providers() {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers: init?.headers ?? {}, body: init?.body });
    const reply = (status: number, body: unknown) => ({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(body)),
    });
    if (method === "GET" && url === "https://api.resend.com/domains") {
      return reply(200, {
        data: [
          { id: "dom_1", name: "mail.vyre.test", status: "verified", region: "us-east-1" },
          { id: "dom_2", name: "send.other.test", status: "pending", region: "eu-west-1" },
        ],
      });
    }
    if (method === "POST" && /^https:\/\/api(\.eu)?\.mailgun\.net\/v3\/routes$/.test(url)) {
      const f = new URLSearchParams(init?.body ?? "");
      return reply(200, {
        route: {
          id: "rt1",
          expression: f.get("expression"),
          priority: Number(f.get("priority")),
          actions: f.getAll("action"),
        },
      });
    }
    return reply(404, { message: "not recorded" });
  };
  return { calls, fetch };
}


interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}
/** Resend as recorded: every email is accepted and given the next id. */
function resend() {
  const calls: Call[] = [];
  let n = 0;
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers: init?.headers ?? {}, body: init?.body });
    const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
    if (method === "POST" && url === "https://api.resend.com/emails") return reply(200, { id: `re_${++n}` });
    return reply(404, { message: "not recorded" });
  };
  return { calls, emails: () => calls.filter((c) => c.method === "POST" && c.url === "https://api.resend.com/emails"), fetch };
}

async function boot(dir: string, p: ReturnType<typeof resend>): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "space.example.com"], {}, "1.2.3"),
    platform: machine(dir),
    fetch: caddyFetch,
    http: p.fetch,
    vault: {
      secret: async (h) => {
        if (h === "#Resend_Key") return "re_live_key";
        throw new Error("no such item");
      },
      signRs256: async () => "",
    },
    seams: {
      files: { read: () => Promise.reject(new Error("no files")) },
      blobs: { put: () => Promise.reject(new Error("no blobs")) },
      members: { emails: () => Promise.resolve([]) },
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000 },
  });
}
const post = async (d: Daemon, p: string, body: unknown) => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as { data?: Record<string, unknown>; error?: { code: string; message?: string } } };
};

test("a soft bounce is retried by the host's own schedule, as the host service, and the message is delivered exactly once", async () => {
  const p = resend();
  const d = await boot(seededDir(), p);
  try {
    const db = d.db!;
    const box = await post(d, "/v1/mail/mailbox/create", { kind: "shared", title: "Hello", address: "hello@mail.vyre.test", provider: "inbound_only", privacy: "space", idempotencyKey: "mb-1" });
    assert.equal(box.status, 200, JSON.stringify(box.body));
    const mailboxId = (box.body.data as { mailbox: { id: string } }).mailbox.id;
    db.run(
      `INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "dom_mailvyretest", "mail.vyre.test", "resend", "pass", "pass", "pass", 1, 1, "[]", Date.now(), 1, Date.now(), null,
    );

    // 1. a person sends; Resend accepts it
    const sent = await post(d, "/v1/mail/send", { mailboxId, to: [{ address: "pat@acme.test" }], subject: "Hello", text: "Hi Pat", idempotencyKey: "send-1" });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const original = (sent.body.data as { messageId: string }).messageId;
    assert.equal(p.emails().length, 1);
    const providerId = String(db.all(`SELECT "providerId" FROM mail_message WHERE id = ?`, original).map((r) => (r as { providerId: string }).providerId)[0]);

    // 2. the provider reports a soft bounce: a retry is scheduled, as the host service, and the message is not called bounced
    const soft = await post(d, "/v1/mail/status_update", { providerId, status: "bounced", kind: "soft", reason: "Mailbox full", address: "pat@acme.test", at: Date.now() });
    assert.equal(soft.status, 200, JSON.stringify(soft.body));
    const jobs = db.all(`SELECT cap, principal_kind, principal_id FROM host_schedule WHERE cap = ?`, "mail.delivery.retry") as { cap: string; principal_kind: string; principal_id: string }[];
    assert.deepEqual(jobs.map((j) => [j.principal_kind, j.principal_id]), [["service", "svc_host"]]);
    assert.equal(String((db.all(`SELECT status FROM mail_message WHERE id = ?`, original)[0] as { status: string }).status), "sent");

    // 3. the wait is over: the host's tick fires the retry; one more email goes out, to that address only
    db.run(`UPDATE host_schedule SET run_at = 0 WHERE cap = ?`, "mail.delivery.retry");
    db.run(`UPDATE mail_delivery_retry SET "nextAt" = 0`);
    await d.schedule!.tick();
    assert.equal(p.emails().length, 2, JSON.stringify(db.all(`SELECT * FROM host_schedule`)));
    assert.deepEqual((JSON.parse(p.emails()[1]!.body ?? "{}") as { to: string[] }).to, ["pat@acme.test"]);
    const child = (db.all(`SELECT "childId" FROM mail_delivery_child WHERE "rootId" = ?`, original)[0] as { childId: string }).childId;
    const childProvider = String((db.all(`SELECT "providerId" FROM mail_message WHERE id = ?`, child)[0] as { providerId: string }).providerId);

    // 4. the provider delivers the retry: the message the person sent is delivered; ticking again sends nothing more
    const done = await post(d, "/v1/mail/status_update", { providerId: childProvider, status: "delivered", address: "pat@acme.test", at: Date.now() });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    await d.schedule!.tick();
    await d.schedule!.tick();
    assert.equal(p.emails().length, 2, "delivered exactly once: never a third email");
    assert.equal(String((db.all(`SELECT status FROM mail_message WHERE id = ?`, original)[0] as { status: string }).status), "delivered");
    const trail = await post(d, "/v1/mail/delivery/trail", { messageId: original });
    assert.equal(trail.status, 200, JSON.stringify(trail.body));
    const kinds = (trail.body.data as { events: { kind: string }[] }).events.map((e) => e.kind);
    for (const k of ["sent", "soft_bounced", "retry_scheduled", "retried", "delivered"]) assert.ok(kinds.includes(k), `${k} is on the trail: ${kinds.join(", ")}`);

    // 5. a person cannot run a retry, early or late
    const early = await post(d, "/v1/mail/delivery/retry", { messageId: original, address: "pat@acme.test", attempt: 2 });
    assert.equal(early.error?.code ?? early.body.error?.code, "permission.no_grant");
  } finally {
    await d.stop();
  }
});
