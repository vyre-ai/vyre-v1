// P-L5_17: a provider's webhook enters a Space through POST /hooks/<connector>, signed, and only there. Over the real route on a booted daemon, for Zoom, Stripe, GitHub and Twilio:
// a good signature is recorded, a bad one is refused (401), a stale one (the providers that sign a time) is refused, and a person calling receive_webhook through the gateway directly is refused,
// the owner included, because only the server records a webhook. The signatures are made here with Web Crypto, exactly as each provider documents them.
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const MEMBER = "tok-usr_noah";
const SECRETS: Record<string, string> = { "#Zoom_Webhook_Secret": "zoom-whsec", "#Stripe_Webhook_Secret": "stripe-whsec", "#GitHub_App_Webhook_Secret": "github-whsec", "#Twilio_Auth": "twilio-auth" };

const enc = new TextEncoder();
async function hmac(hash: "SHA-256" | "SHA-1", secret: string, data: string): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

async function boot() {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-hooks-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "hooks-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    vault: { secret: (handle: string) => (SECRETS[handle] !== undefined ? Promise.resolve(SECRETS[handle]) : Promise.reject(new Error("no such item"))), signRs256: () => Promise.reject(new Error("no such item")) },
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER ? "usr_olivia" : t === MEMBER ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "hooks-live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

test("webhook ingress: Zoom, Stripe, GitHub and Twilio take a signed event, refuse a forged or stale one, and nobody can post receive_webhook directly", async () => {
  const d = await boot();
  const post = (p: string, body: string, headers: Record<string, string>) =>
    fetch(`${d.url}${p}`, { method: "POST", headers, body, signal: AbortSignal.timeout(8_000) });
  const why = async (r: Response): Promise<string> => `${r.status} ${await r.text()}`;
  try {
    const now = Date.now();
    const nowS = Math.floor(now / 1000);

    // ---- Zoom: v0:<ts>:<body>, five minutes, the URL check answered
    const zoomBody = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "qgg8vlvZRS6UYooatFL8Aw" } });
    const zoomSig = async (ts: number, body = zoomBody) => ({ "content-type": "application/json", "x-zm-request-timestamp": String(ts), "x-zm-signature": `v0=${hex(await hmac("SHA-256", SECRETS["#Zoom_Webhook_Secret"]!, `v0:${ts}:${body}`))}` });
    const zoomGood = await post("/hooks/zoom", zoomBody, await zoomSig(nowS));
    assert.equal(zoomGood.status, 200, await why(zoomGood.clone()));
    assert.deepEqual(await zoomGood.json(), { plainToken: "qgg8vlvZRS6UYooatFL8Aw", encryptedToken: hex(await hmac("SHA-256", SECRETS["#Zoom_Webhook_Secret"]!, "qgg8vlvZRS6UYooatFL8Aw")) }, "Zoom's URL check is answered with the token pair");
    assert.equal((await post("/hooks/zoom", zoomBody, { ...(await zoomSig(nowS)), "x-zm-signature": "v0=" + "0".repeat(64) })).status, 401, "a wrong signature");
    assert.equal((await post("/hooks/zoom", zoomBody, await zoomSig(nowS - 6 * 60))).status, 401, "a correctly signed request six minutes old");
    assert.equal((await post("/hooks/zoom", zoomBody, { "content-type": "application/json" })).status, 401, "no signature at all");

    // ---- Stripe: t=<s>,v1=<hex of "<t>.<body>">, five minutes
    const stripeBody = JSON.stringify({ id: "evt_hooks_1", type: "customer.created", created: nowS, data: { object: { id: "cus_1" } } });
    const stripeSig = async (ts: number, body = stripeBody) => ({ "content-type": "application/json", "stripe-signature": `t=${ts},v1=${hex(await hmac("SHA-256", SECRETS["#Stripe_Webhook_Secret"]!, `${ts}.${body}`))}` });
    const stripeGood = await post("/hooks/stripe", stripeBody, await stripeSig(nowS));
    assert.equal(stripeGood.status, 200, await why(stripeGood.clone()));
    assert.equal((await post("/hooks/stripe", stripeBody, await stripeSig(nowS))).status, 200, "the same event twice is accepted and recorded once");
    assert.equal((await post("/hooks/stripe", stripeBody + " ", await stripeSig(nowS))).status, 401, "a body changed after signing");
    assert.equal((await post("/hooks/stripe", stripeBody, await stripeSig(nowS - 6 * 60))).status, 401, "a correctly signed request six minutes old");

    // ---- GitHub: sha256=<hex of the body>, the delivery id dedupes
    const ghBody = JSON.stringify({ zen: "Keep it logically awesome.", hook_id: 1 });
    const ghHeaders = async (body = ghBody) => ({ "content-type": "application/json", "x-github-event": "ping", "x-github-delivery": "11111111-2222-3333-4444-555555555555", "x-hub-signature-256": `sha256=${hex(await hmac("SHA-256", SECRETS["#GitHub_App_Webhook_Secret"]!, body))}` });
    const ghGood = await post("/hooks/github", ghBody, await ghHeaders());
    assert.equal(ghGood.status, 200, await why(ghGood.clone()));
    assert.equal((await post("/hooks/github", ghBody, { ...(await ghHeaders()), "x-hub-signature-256": "sha256=" + "0".repeat(64) })).status, 401, "a wrong signature");
    assert.equal((await post("/hooks/github", ghBody + " ", await ghHeaders())).status, 401, "a body changed after signing");

    // ---- Twilio: HMAC-SHA1 over the URL then each field name and value in order, base64; the answer is TwiML
    const params: Record<string, string> = { MessageSid: "SMhooks1", From: "+14155550100", To: "+14155550101", Body: "hello" };
    const form = new URLSearchParams(params).toString();
    const twilioUrl = `${d.url}/hooks/twilio/sms`;
    const twilioSig = async (url: string) => ({ "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": Buffer.from(await hmac("SHA-1", SECRETS["#Twilio_Auth"]!, Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url))).toString("base64") });
    const twilioGood = await post("/hooks/twilio/sms", form, await twilioSig(twilioUrl));
    assert.equal(twilioGood.status, 200, await why(twilioGood.clone()));
    assert.match(twilioGood.headers.get("content-type") ?? "", /xml/, "Twilio is answered with TwiML");
    assert.equal((await post("/hooks/twilio/sms", form, await twilioSig(`${d.url}/hooks/twilio/voice`))).status, 401, "a signature made for another address");
    assert.equal((await post("/hooks/twilio/sms", form + "&Extra=1", await twilioSig(twilioUrl))).status, 401, "a field added after signing");

    // ---- nobody posts receive_webhook through the gateway: not a member, not the owner
    for (const [cap, body] of [
      ["zoom", { eventId: "e1", type: "endpoint.url_validation", plainToken: "x", at: now }],
      ["stripe", { eventId: "e2", type: "customer.created", objectId: "cus_2", amount: 0, currency: "USD", at: now }],
      ["github", { deliveryId: "d1", event: "ping" }],
      ["twilio", { kind: "sms", dedupeKey: "sms:SMx", sid: "SMx", params: params }],
    ] as const) {
      for (const token of [MEMBER, OWNER]) {
        const r = await fetch(`${d.url}/v1/${cap}/receive_webhook`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
        const text = await r.text();
        assert.equal(r.status, 403, `${cap} receive_webhook for ${token === OWNER ? "the owner" : "a member"}: ${r.status} ${text}`);
        assert.equal((JSON.parse(text) as { error?: { code?: string } }).error?.code, "permission.no_grant");
      }
    }
    // the host call behind the route is not reachable from outside either: no route names it, and nothing a client sends changes where a call comes from (origin is set by the server)
    for (const cap of ["zoom", "stripe", "github", "twilio"]) {
      for (const token of [MEMBER, OWNER]) {
        for (const p of [`/v1/${cap}/accept_webhook`, `/v1/host/hook/call/${cap}/accept_webhook`]) {
          const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-vyre-origin": "hook", origin: "hook" }, body: JSON.stringify({ headers: {}, body: "{}", url: "x", origin: "hook", depth: 0 }), signal: AbortSignal.timeout(8_000) });
          const text = await r.text();
          assert.ok(r.status === 403 || r.status === 404, `${cap} accept_webhook ${p} for ${token === OWNER ? "the owner" : "a member"}: ${r.status} ${text}`);
          assert.ok(["permission.no_grant", "validation.unknown_capability"].includes((JSON.parse(text) as { error?: { code?: string } }).error?.code ?? ""), text);
        }
      }
    }
    // a client cannot say it is the server: the headers and the body of a direct receive_webhook call change nothing
    const forged = await fetch(`${d.url}/v1/zoom/receive_webhook`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}`, "x-vyre-origin": "hook", origin: "hook" }, body: JSON.stringify({ eventId: "e9", type: "endpoint.url_validation", plainToken: "x", at: now, origin: "hook" }), signal: AbortSignal.timeout(8_000) });
    assert.equal(forged.status, 403, await forged.text());
    // a connector that is not there is not a route
    assert.equal((await post("/hooks/nothing", "{}", {})).status, 404);
  } finally { await d.stop(); }
});
