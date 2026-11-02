// Golden flow 5: a lead, an Automation's email, a reply, a call (spec 2.12, 2.18 to 2.20; ARCH 8.2). A lead is made, an Automation mails the lead after the Gate approves the send, the email carries the lead's own
// unsubscribe link, the lead's reply is matched to the lead and joins the thread of that email, and a person calls the lead from a Twilio number. Through the gateway with real tokens; only the providers are fake: Resend and Twilio answer from a fake network the daemon's
// fetch seam is given, and the DNS lookups behind the sending-domain check answer from the records the fake Resend published.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import { signatureOf } from "../../modules/twilio/handlers/hooks.ts";
import { setDefaultDns } from "../../modules/mail/handlers/extra/dns.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import type { SeamFetch } from "../../host/src/seams/ports.ts";

export const LIVE_FOR_LEAD = ["automations", "runs", "steps-core", "gate", "mail", "telephony", "twilio", "resend", "contacts-link", "records", "schema", "tasks", "settings", "search", "devices", "access", "spaces"];
export const GAPS: Gap[] = [];

const DOMAIN = "send.acme.test";
const PUBLIC = "space.acme.test";
const LEAD = { name: "Lena Lead", email: "lena@lead.example.test", phone: "+14155550123" };
const NUMBER = "+14155550100";
const CONTACT = {
  op: "type.create", type: "contact",
  def: {
    title: "Contact", plural: "Contacts", icon: "user", titleField: "name",
    fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "email", type: "text", title: "Email" }, { key: "phone", type: "text", title: "Phone" }],
  },
};

/** What the providers were asked, so a step can assert the request really went out. */
export interface Net { requests: string[]; emails: { text?: string; headers?: Record<string, string> }[] }

type Net2 = FetchFn & SeamFetch;
const json = (status: number, body: unknown): ReturnType<Net2> => Promise.resolve({
  ok: status < 300, status, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)), arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer),
});

/** A fake network: the Caddy admin API the daemon probes, Resend (domains and sends) and Twilio (numbers and calls). */
export function fakeNet(net: Net, dns: Map<string, string[]>): Net2 {
  let n = 0;
  return (url, init) => {
    const method = init?.method ?? "GET";
    const u = new URL(url);
    net.requests.push(`${method} ${u.host}${u.pathname}`);
    if (u.host === "api.resend.com") {
      if (u.pathname === "/emails" && method === "POST") {
        net.emails.push(JSON.parse(String(init?.body ?? "{}")) as Net["emails"][number]);
        return json(200, { id: `re_${++n}` });
      }
      if (u.pathname === "/domains" && method === "POST") {
        const records = [
          { record: "SPF", type: "TXT", name: DOMAIN, value: "v=spf1 include:amazonses.com ~all", status: "not_started" },
          { record: "DKIM", type: "TXT", name: `resend._domainkey.${DOMAIN}`, value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDfake", status: "not_started" },
        ];
        for (const r of records) dns.set(r.name, [r.value]);
        dns.set(`_dmarc.${DOMAIN}`, ["v=DMARC1; p=none"]);
        return json(200, { id: "dom_fake1", name: DOMAIN, status: "not_started", records });
      }
      if (u.pathname.endsWith("/verify")) return json(200, { id: "dom_fake1" });
      if (u.pathname.startsWith("/domains/")) {
        const records = [
          { record: "SPF", type: "TXT", name: DOMAIN, value: "v=spf1 include:amazonses.com ~all", status: "verified" },
          { record: "DKIM", type: "TXT", name: `resend._domainkey.${DOMAIN}`, value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDfake", status: "verified" },
        ];
        return json(200, { id: "dom_fake1", name: DOMAIN, status: "verified", records });
      }
      if (u.pathname === "/domains") return json(200, { data: [] });
    }
    if (u.host === "api.twilio.com") {
      if (u.pathname.endsWith("/IncomingPhoneNumbers.json")) {
        return json(200, { incoming_phone_numbers: [{ sid: "PNfake1", phone_number: NUMBER, friendly_name: "Sales line", capabilities: { voice: true, sms: true, mms: false } }] });
      }
      if (u.pathname.endsWith("/Calls.json") && method === "POST") return json(201, { sid: "CAfake1", status: "queued" });
    }
    // everything else is the Caddy admin probe
    return json(200, { apps: { http: {} } });
  };
}

/** The lookups behind mail.domain.check, answering from the records the fake Resend published. */
function fakeDns(zone: Map<string, string[]>): Parameters<typeof setDefaultDns>[0] {
  const miss = (): never => { throw Object.assign(new Error("no data"), { code: "ENODATA" }); };
  return {
    txt: (name) => Promise.resolve(zone.get(name.toLowerCase()) ?? miss()),
    cname: () => Promise.resolve(miss()),
    mx: () => Promise.resolve(miss()),
  };
}

/** The run moves on its own; the flow's slow timers are hours long, so the wait also pumps the hooks. */
async function until<T>(what: string, look: () => Promise<T | undefined>, s?: { hooks?: { pump(): Promise<unknown> } | null }): Promise<T> {
  const end = Date.now() + 15_000;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await s?.hooks?.pump();
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function runLead(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail; net: Net }> {
  const trail = new Trail();
  const net: Net = { requests: [], emails: [] };
  const zone = new Map<string, string[]>();
  setDefaultDns(fakeDns(zone));
  const { s } = await bootTolerant(trail, live, {
    address: PUBLIC,
    fetch: fakeNet(net, zone),
    vault: { secret: (handle) => Promise.resolve(`fake-${handle.replace(/^#/, "")}`), signRs256: () => Promise.resolve("") },
  });
  if (!s) return { events: [], trail, net };
  try {
    const admin = s.d.token;
    await trail.step("the contact type exists", async () => {
      const r = await s.call("schema.apply", admin, { idempotencyKey: "golden-5-type", ops: [CONTACT] });
      if (r.status !== 422 || r.body?.error?.code !== "validation.duplicate") expectStatus(r, 200, "schema.apply");
    });
    const lead = await trail.step("a lead is made", async () =>
      expectStatus(await s.call("records.create", admin, { idempotencyKey: "golden-5-lead", type: "contact", fields: LEAD }), 200, "records.create").record.id as string,
    ["the contact type exists"]);

    await trail.step("a sending domain is added and verifies", async () => {
      const added = expectStatus(await s.call("mail.domain.add", admin, { idempotencyKey: "golden-5-domain", name: DOMAIN, provider: "resend" }), 200, "mail.domain.add");
      const id = (added.domain?.id ?? added.domainId ?? added.id) as string;
      const checked = expectStatus(await s.call("mail.domain.check", admin, { domainId: id }), 200, "mail.domain.check");
      assert.equal((checked.domain ?? checked).verified, true, `the domain verifies: ${short(checked)}`);
    });
    const mailbox = await trail.step("a service mailbox sends from that domain", async () => {
      const m = expectStatus(await s.call("mail.mailbox.create", admin, { idempotencyKey: "golden-5-mailbox", kind: "service", address: `hello@${DOMAIN}`, title: "Acme" }), 200, "mail.mailbox.create").mailbox;
      return (m.mailboxId ?? m.id) as string;
    }, ["a sending domain is added and verifies"]);

    const flow = await trail.step("an Automation is built to mail the lead", async () => {
      const made = expectStatus(await s.call("automations.create", admin, { idempotencyKey: "golden-5-flow", name: "Welcome the lead" }), 200, "automations.create");
      const automationId = (made.automation?.id ?? made.automationId) as string;
      expectStatus(await s.call("automations.update", admin, {
        automationId, definition: {
          triggers: [{ key: "manual" }],
          nodes: [{ id: "hello", key: "send_email", askBeforeSending: true, input: { mailboxId: mailbox!, to: [LEAD.email], subject: `Hello ${LEAD.name}`, body: `Hi ${LEAD.name}, can we talk?`, recordId: lead! } }],
        },
      }), 200, "automations.update");
      expectStatus(await s.call("automations.promote", admin, { automationId, confirm: true }), 200, "automations.promote");
      const service = { kind: "service", id: `svc_${automationId.slice(4)}` };
      // a Space Automation runs as its own service, which holds nothing until a person shares: `use` on the Space reaches the sending provider, `use` on the mailbox sends from it
      expectStatus(await s.call("access.share", admin, { idempotencyKey: "golden-5-share-space", resource: { type: "space", id: "spc_core" }, subject: service, level: "use" }), 200, "access.share");
      expectStatus(await s.call("access.share", admin, { idempotencyKey: "golden-5-share-box", resource: { type: "mailbox", id: mailbox! }, subject: service, level: "use" }), 200, "access.share");
      return automationId;
    }, ["a lead is made", "a service mailbox sends from that domain"]);

    const started = await trail.step("the send is held by the Gate for approval", async () => {
      const runId = expectStatus(await s.call("automations.run", admin, { automationId: flow!, idempotencyKey: "golden-5-run" }), 200, "automations.run").runId as string;
      const hold = await until("the send to wait for approval", async () => {
        const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"], runId }), 200, "gate.holds.list").holds as { taskId?: string; capName?: string; act?: string }[];
        return holds[0];
      }, s.d);
      assert.equal(hold.capName, "mail.send", short(hold));
      assert.equal(hold.act, "send", short(hold));
      assert.ok(hold.taskId, `a task waits for the approver: ${short(hold)}`);
      assert.ok(!net.requests.includes("POST api.resend.com/emails"), "nothing leaves before the yes");
      return { runId, taskId: hold.taskId };
    }, ["an Automation is built to mail the lead"]);
    await trail.step("a person approves and the Automation mails the lead", async () => {
      expectStatus(await s.call("tasks.act", admin, { taskId: started!.taskId, action: "approve" }), 200, "tasks.act");
      await until("the run to finish after approval", async () => {
        const run = expectStatus(await s.call("runs.get", admin, { runId: started!.runId }), 200, "runs.get").run as { status?: string };
        if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ended ${run.status}: ${short(run)}`);
        return run.status === "succeeded" ? true : undefined;
      }, s.d);
      assert.ok(net.requests.includes("POST api.resend.com/emails"), `Resend was asked to send: ${short(net.requests)}`);
      assert.equal(net.emails.length, 1, `the lead got one email: ${short(net.emails)}`);
      const email = net.emails[0]!;
      assert.match(email.text ?? "", new RegExp(`To stop these emails: https://${PUBLIC}/u/[A-Za-z0-9_-]{16,}`), `the email carries the lead's own link: ${short(email)}`);
      assert.match(email.headers?.["List-Unsubscribe"] ?? "", new RegExp(`^<https://${PUBLIC}/u/`), `the mail client gets the same link: ${short(email.headers)}`);
    }, ["the send is held by the Gate for approval"]);

    const reply = await trail.step("the lead replies and the reply is matched to the lead", async () => {
      // the message the Automation sent carries the RFC id the reply answers
      const sent = expectStatus(await s.call("mail.message.list", admin, { mailboxId: mailbox! }), 200, "mail.message.list");
      const first = (sent.messages as { id?: string; threadId?: string; direction?: string }[] | undefined)?.find((m) => m.direction === "out");
      assert.ok(first?.id, `the Automation's email is in the mailbox: ${short(sent)}`);
      const out = expectStatus(await s.call("mail.ingest", admin, {
        source: "resend", mailboxId: mailbox!, providerId: "re_reply_1", rfcMessageId: "<reply-1@lead.example.test>", direction: "in",
        from: { address: LEAD.email, name: LEAD.name }, to: [{ address: `hello@${DOMAIN}` }], subject: `Re: Hello ${LEAD.name}`, text: "Yes, call me.", receivedAt: Date.now(),
        headers: { "in-reply-to": `<${first!.id}@${DOMAIN}>` },
      }), 200, "mail.ingest");
      assert.equal(out.contactId, lead, `the reply is linked to the lead: ${short(out)}`);
      return { id: out.messageId as string, threadId: first!.threadId };
    }, ["a person approves and the Automation mails the lead"]);
    await trail.step("the reply joins the thread of the Automation's email", async () => {
      await s.d.hooks?.pump();
      const inbox = expectStatus(await s.call("mail.message.list", admin, { mailboxId: mailbox!, contactId: lead! }), 200, "mail.message.list").messages as { id: string; threadId?: string; direction: string }[];
      const got = inbox.find((m) => m.id === reply!.id);
      assert.equal(got?.threadId, reply!.threadId, `the reply is on the thread: ${short(inbox)}`);
      assert.deepEqual(inbox.map((m) => m.direction).sort(), ["in", "out"], `the lead's history holds both: ${short(inbox)}`);
    }, ["the lead replies and the reply is matched to the lead"]);

    await trail.step("the lead leaves through the link, with no account", async () => {
      const token = /\/u\/([A-Za-z0-9_-]{16,})/.exec(net.emails[0]?.text ?? "")?.[1] as string;
      const listed = async (): Promise<unknown[]> => expectStatus(await s.call("contacts.suppression.check", admin, { channel: "email", addresses: [LEAD.email] }), 200, "contacts.suppression.check").suppressed as unknown[];
      for (const p of [`/u/${token}`, `/p/u/${token}`]) assert.equal((await fetch(s.d.url + p)).status, 200, p);
      assert.deepEqual(await listed(), [], "opening the link changes nothing: a mail scanner fetches every link");
      const left = await fetch(`${s.d.url}/p/u/${token}`, { method: "POST" });
      assert.equal(left.status, 200);
      assert.match(await left.text(), /You are unsubscribed/);
      assert.equal((await listed()).length, 1, "the lead is on the suppression list");
    }, ["a person approves and the Automation mails the lead"]);
    await trail.step("the same flow skips the lead from then on", async () => {
      const runId = expectStatus(await s.call("automations.run", admin, { automationId: flow!, idempotencyKey: "golden-5-run-2" }), 200, "automations.run").runId as string;
      const hold = await until("the second send to wait for approval", async () => {
        const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"], runId }), 200, "gate.holds.list").holds as { taskId?: string }[];
        return holds[0];
      }, s.d);
      expectStatus(await s.call("tasks.act", admin, { taskId: hold.taskId, action: "approve" }), 200, "tasks.act");
      await until("the second run to end", async () => {
        const run = expectStatus(await s.call("runs.get", admin, { runId }), 200, "runs.get").run as { status?: string };
        return run.status === "succeeded" || run.status === "failed" || run.status === "stopped" ? true : undefined;
      }, s.d);
      assert.equal(net.emails.length, 1, `nothing more reached the lead: ${short(net.emails)}`);
      const events = (await s.events()).filter((e) => e.type === "message.suppressed");
      assert.ok(events.length >= 1, "the skip is on the record");
    }, ["the lead leaves through the link, with no account"]);

    const number = await trail.step("the Twilio number is brought in", async () => {
      const out = expectStatus(await s.call("telephony.number.import", admin, { idempotencyKey: "golden-5-number" }), 200, "telephony.number.import");
      assert.equal(out.imported, 1, `one number is imported: ${short(out)}`);
      return (out.numbers[0].numberId ?? out.numbers[0].id) as string;
    });
    await trail.step("a person calls the lead", async () => {
      const out = expectStatus(await s.call("telephony.dial", admin, { idempotencyKey: "golden-5-call", numberId: number!, to: LEAD.phone, contactId: lead! }), 200, "telephony.dial");
      assert.ok(out.callId, `a call is placed: ${short(out)}`);
      assert.ok(net.requests.includes("POST api.twilio.com/2010-04-01/Accounts/fake-Twilio_Account/Calls.json"), `Twilio was asked to place the call: ${short(net.requests)}`);
    }, ["the Twilio number is brought in", "a lead is made"]);
    await trail.step("the lead picks up and Twilio reports it through the signed hook", async () => {
      // what Twilio sends: a form body, and a signature of the full address and the sorted fields made with the account's auth token
      const params = { CallSid: "CAfake1", CallStatus: "in-progress" };
      // Twilio signs the public address this Space gave it, whatever socket the request arrives on
      const res = await fetch(`${s.d.url}/hooks/twilio/status`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": await signatureOf("fake-Twilio_Auth", `https://${PUBLIC}/hooks/twilio/status`, params) },
        body: new URLSearchParams(params).toString(),
      });
      assert.equal(res.status, 200, `the hook is accepted: ${res.status} ${(await res.text()).slice(0, 300)}`);
      await s.d.hooks?.pump();
    }, ["a person calls the lead"]);
    return { events: await s.events(), trail, net };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runLead(LIVE_FOR_LEAD);
  if (trail.failures.length) throw new Error(`flow 5 failed:\n${trail.report()}`);
  return events;
}
