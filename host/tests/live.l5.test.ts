// P-L5_LIVE (rulings 31, 32): the L5 modules that are done are live on a booted daemon. host/modules.json has them live, no L5 module is reported as not set up, the Stripe, Twilio and GitHub
// host seams are wired, and one read and one write capability per module answer through the gateway with a real token. A member without connectors.manage is refused.
// Meetings, telephony and zoom are live too (P-L5_LIVE2); Zoom and Twilio calls that need an account answer a clean refusal when the Space has no key.
// Path mapping: the packet owns __live__/L5; this test sits in host/tests because it boots the daemon.
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

const LIVE = ["calendar", "contacts-link", "github", "google", "inbox", "mail", "mailgun", "meetings", "microsoft", "resend", "stripe", "telephony", "twilio", "zoom"];

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l5-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const OWNER = "tok-usr_olivia";
const MEMBER = "tok-usr_noah";
const AT = 1_790_000_000_000;

// [module, read, write]: each a path and a body. The reads and writes need no provider account; the answers come from the module's own tables.
// A null write: the connector's writes need the provider's account, so they are checked below as clean refusals. receive_webhook is not a write anyone makes here: only the server records a webhook (webhooks.live.test.ts).
const CALLS: [string, [string, unknown], [string, unknown] | null][] = [
  ["calendar", ["/v1/calendar/list_calendars", {}], ["/v1/calendar/create_calendar", { idempotencyKey: "l5-cal", title: "Team" }]],
  ["contacts-link", ["/v1/contacts/suppression/list", {}], ["/v1/contacts/suppression/add", { channel: "email", addresses: ["optout@example.com"], reason: "manual" }]],
  ["github", ["/v1/github/health", {}], ["/v1/github/app/create_manifest", { org: "acme" }]],
  ["google", ["/v1/google/health", {}], ["/v1/google/dwd/disable", {}]],
  ["inbox", ["/v1/inbox/counts", {}], ["/v1/inbox/link_message", { channel: "email", ref: { kind: "mail_message", id: "msg_1" }, address: "a@example.com", direction: "in", at: AT }]],
  ["mail", ["/v1/mail/mailbox/list", {}], ["/v1/mail/mailbox/create", { idempotencyKey: "l5-mbx", kind: "shared", address: "team@example.com", title: "Team", provider: "inbound_only" }]],
  ["meetings", ["/v1/meetings/list", {}], ["/v1/meetings/ingest", { source: "zoom", providerRef: "8123456789", startsAt: AT, attendees: [{ email: "client@example.com", name: "Client" }] }]],
  ["telephony", ["/v1/telephony/number/list", {}], ["/v1/telephony/registration/save", { legalName: "Northwind Legal LLC" }]],
  ["zoom", ["/v1/zoom/health", {}], null],
  ["microsoft", ["/v1/ms/health", {}], ["/v1/ms/consent/disable", {}]],
  ["stripe", ["/v1/stripe/health", {}], null],
  ["twilio", ["/v1/twilio/health", {}], null],
];

test("l5 live: host/modules.json has every finished L5 module live", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; owner: string; status: string }[] };
  for (const id of LIVE) assert.equal(file.modules.find((m) => m.id === id)?.status, "live", `${id} status`);
});

test("l5 live: a booted daemon has no L5 module not set up, and a read and a write per module answer through the gateway", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l5-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER ? "usr_olivia" : t === MEMBER ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "l5-live" };
    },
    // the Vault holds one item: Zoom's webhook secret (the URL check is signed with it); every other key is missing, which is what the clean-refusal checks below rely on
    vault: { secret: (handle: string) => (handle === "#Zoom_Webhook_Secret" ? Promise.resolve("whsec_l5_test") : Promise.reject(new Error("no such item"))), signRs256: () => Promise.reject(new Error("no such item")) },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = (token: string, p: string, body: unknown) =>
    fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const why = (body: string): string => {
    const traceId = /"traceId":"([0-9a-f]+)"/.exec(body)?.[1];
    if (!traceId) return "";
    d.sink.flush();
    return ` | log: ${JSON.stringify(d.sink.trace(traceId).logs.map((l) => [l.msg, l.attrs]))}`;
  };
  try {
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module !== undefined && LIVE.includes(m.module)), [], "no L5 module is reported as not set up");
    for (const setter of ["setStripeHost", "setTwilioHost", "setGithubHost", "setGoogleHost", "setMsHost", "setImapSecretResolver"]) assert.ok((d.seams?.wired ?? []).includes(setter), `${setter} is wired`);

    // every module is tried, and every failure is reported together
    const failures: string[] = [];
    for (const [module, read, write] of CALLS) {
      for (const [kind, [p, body]] of ([["read", read], ["write", write]] as const).filter((x): x is readonly ["read" | "write", [string, unknown]] => x[1] !== null)) {
        const r = await post(OWNER, p, body);
        const text = await r.text();
        if (r.status !== 200) failures.push(`${module} ${kind} ${p}: ${r.status} ${text}${why(text)}`);
      }
    }
    assert.deepEqual(failures, [], "every read and write answers through the live handler");

    // an account the Space has not set up refuses cleanly: a 4xx with a provider or precondition code, never a crash
    for (const [p, body] of [
      ["/v1/zoom/meetings/create", { idempotencyKey: "l5-zoom-no-key", topic: "Intake" }], ["/v1/twilio/number/search", {}],
      ["/v1/stripe/customer/create", { idempotencyKey: "l5-stripe-no-key" }], ["/v1/twilio/sms/send", { idempotencyKey: "l5-sms-no-key", from: "+14155550100", to: "+14155550101", body: "hi" }],
    ] as const) {
      const r = await post(OWNER, p, body);
      const text = await r.text();
      assert.ok(r.status >= 400 && r.status < 500, `${p} with no key answers a refusal, got ${r.status} ${text}${why(text)}`);
    }

    // a member holds no connectors.manage: refused before the handler runs
    const refused = await post(MEMBER, "/v1/google/dwd/disable", {});
    assert.equal(refused.status, 403, "a member cannot change the Google connection");
    assert.equal(((await refused.json()) as { error?: { code?: string } }).error?.code, "permission.role_lacks_permission");
  } finally { await d.stop(); }
});
