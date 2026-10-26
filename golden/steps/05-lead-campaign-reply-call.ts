// Golden flow 5: a lead, a gated campaign, a reply, a call (spec 2.18 to 2.20; ARCH 7.6, 8.2). A lead is made, a campaign mails the lead after the Gate approves the launch, the lead's reply is matched to the lead
// and to the campaign, and a person calls the lead from a Twilio number. Through the gateway with real tokens; only the providers are fake: Resend and Twilio answer from a fake network the daemon's
// fetch seam is given, and the DNS lookups behind the sending-domain check answer from the records the fake Resend published.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import { setDefaultDns } from "../../modules/mail/handlers/extra/dns.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import type { SeamFetch } from "../../host/src/seams/ports.ts";

export const LIVE_FOR_LEAD = ["campaigns", "gate", "mail", "telephony", "twilio", "resend", "contacts-link", "records", "schema", "tasks", "settings", "search", "devices", "access", "spaces"];
export const GAPS: Gap[] = [];

const DOMAIN = "send.acme.test";
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
export interface Net { requests: string[] }

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
      if (u.pathname === "/emails" && method === "POST") return json(200, { id: `re_${++n}` });
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

export async function runLead(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail; net: Net }> {
  const trail = new Trail();
  const net: Net = { requests: [] };
  const zone = new Map<string, string[]>();
  setDefaultDns(fakeDns(zone));
  const { s } = await bootTolerant(trail, live, {
    fetch: fakeNet(net, zone),
    vault: { secret: (handle) => Promise.resolve(`fake-${handle.replace(/^#/, "")}`), signRs256: () => Promise.resolve("") },
  });
  if (!s) return { events: [], trail, net };
  try {
    const admin = s.d.token;
    // Adam drafts and launches; the Gate does not let a person approve what they asked for, so the owner approves
    const adam = s.signedIn("usr_adam");

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
    const mailbox = await trail.step("a shared mailbox sends from that domain", async () => {
      const m = expectStatus(await s.call("mail.mailbox.create", admin, { idempotencyKey: "golden-5-mailbox", kind: "shared", address: `hello@${DOMAIN}`, title: "Acme" }), 200, "mail.mailbox.create").mailbox;
      return (m.mailboxId ?? m.id) as string;
    }, ["a sending domain is added and verifies"]);

    const campaign = await trail.step("a campaign is drafted for the lead", async () => {
      const c = expectStatus(await s.call("campaigns.create", adam, { idempotencyKey: "golden-5-campaign", name: "Spring outreach", kind: "sequence" }), 200, "campaigns.create").campaign;
      const campaignId = (c.campaignId ?? c.id) as string;
      expectStatus(await s.call("campaigns.steps_set", adam, {
        // a sequence: after the first email the lead waits two days, so the campaign is still running when the reply comes in
        campaignId, steps: [
          { key: "hello", type: "email", config: { mailboxId: mailbox!, subject: "Hello {{name}}", text: "Hi {{name}}, can we talk?" } },
          { key: "pause", type: "wait", config: { days: 2 } },
          { key: "nudge", type: "email", config: { mailboxId: mailbox!, subject: "Following up, {{name}}", text: "Did you see my note?" } },
        ],
      }), 200, "campaigns.steps_set");
      const aud = expectStatus(await s.call("campaigns.audience_set", adam, { campaignId, type: "contact", filter: { field: "email", op: "eq", value: LEAD.email } }), 200, "campaigns.audience_set");
      assert.equal(aud.count, 1, `the audience is the lead: ${short(aud)}`);
      return campaignId;
    }, ["a lead is made", "a shared mailbox sends from that domain"]);

    const held = await trail.step("launching is held by the Gate for approval", async () => {
      const r = await s.call("campaigns.launch", adam, { idempotencyKey: "golden-5-launch", campaignId: campaign! });
      expectStatus(r, 202, "campaigns.launch");
      assert.equal(r.body?.data?.status, "held", `the launch is held: ${short(r.body)}`);
      assert.ok(r.body?.data?.taskId, `a task waits for the approver: ${short(r.body)}`);
      return r.body.data.taskId as string;
    }, ["a campaign is drafted for the lead"]);
    await trail.step("a person approves and the campaign mails the lead", async () => {
      const act = expectStatus(await s.call("tasks.act", admin, { taskId: held!, action: "approve" }), 200, "tasks.act");
      void act;
      const stats = expectStatus(await s.call("campaigns.stats", admin, { campaignId: campaign! }), 200, "campaigns.stats");
      if (stats.sent !== 1) {
        const c = await s.call("campaigns.get", adam, { campaignId: campaign! });
        const m = await s.call("mail.message.list", admin, { mailboxId: mailbox! });
        s.d.sink.flush();
        const logs = (s.d.sink.db.prepare("SELECT msg, attrs FROM logs WHERE msg LIKE '%campaigns%' OR msg LIKE '%send%' OR level >= 40 ORDER BY id DESC LIMIT 10").all() as { msg: string; attrs: string | null }[]).map((l) => `${l.msg} ${l.attrs ?? ""}`.slice(0, 350));
        const probe = await s.call("mail.send", adam, { idempotencyKey: "golden-5-probe", mailboxId: mailbox!, to: [{ address: LEAD.email, contactId: lead! }], subject: "probe", text: "probe", contactId: lead!, campaignId: campaign! });
        const members = s.d.db!.all("SELECT state, step_key, due_at, address FROM campaigns_member");
        assert.fail(`probe ${probe.status} ${short(probe.body)} members ${short(members)} logs ${short(logs)} the lead got the email: ${short(stats)} campaign ${short(c.body?.data?.campaign)} mail ${short(m.body?.data ?? m.body)} net ${short(net.requests)}`.slice(0, 4000));
      }
      assert.ok(net.requests.includes("POST api.resend.com/emails"), `Resend was asked to send: ${short(net.requests)}`);
    }, ["launching is held by the Gate for approval"]);

    const reply = await trail.step("the lead replies and the reply is matched to the lead and the campaign", async () => {
      // the message the campaign sent carries the RFC id the reply answers
      const sent = expectStatus(await s.call("mail.message.list", admin, { mailboxId: mailbox!, direction: "out" }), 200, "mail.message.list");
      const first = (sent.messages as { id?: string }[] | undefined)?.[0];
      assert.ok(first?.id, `the campaign's email is in the mailbox: ${short(sent)}`);
      const out = expectStatus(await s.call("mail.ingest", admin, {
        source: "resend", mailboxId: mailbox!, providerId: "re_reply_1", rfcMessageId: "<reply-1@lead.example.test>", direction: "in",
        from: { address: LEAD.email, name: LEAD.name }, to: [{ address: `hello@${DOMAIN}` }], subject: "Re: Hello Lena Lead", text: "Yes, call me.", receivedAt: Date.now(),
        headers: { "in-reply-to": `<${first!.id}@${DOMAIN}>` },
      }), 200, "mail.ingest");
      assert.equal(out.contactId, lead, `the reply is linked to the lead: ${short(out)}`);
      return out.messageId as string;
    }, ["a person approves and the campaign mails the lead"]);
    await trail.step("the campaign announces the reply", async () => {
      // the campaigns consumer reads mail.received from the log on the projection pump, which the test daemon runs on demand (its timers are an hour long)
      await s.d.projections?.pump();
      expectStatus(await s.call("campaigns.resume", admin, { campaignId: campaign! }), 200, "campaigns.resume");
      const replies = expectStatus(await s.call("campaigns.replies", admin, { campaignId: campaign! }), 200, "campaigns.replies").replies as unknown[];
      const inbox = expectStatus(await s.call("mail.message.list", admin, { mailboxId: mailbox!, contactId: lead! }), 200, "mail.message.list").messages as { id: string; campaignId?: string; direction: string }[];
      const got = inbox.find((m) => m.id === reply);
      assert.equal(got?.campaignId, campaign, `the reply carries the campaign: ${short(inbox)}`);
      assert.ok(replies.length >= 1, `the campaign lists the reply ${reply!}: ${short(replies)}`);
    }, ["the lead replies and the reply is matched to the lead and the campaign"]);

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
    return { events: await s.events(), trail, net };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runLead(LIVE_FOR_LEAD);
  if (trail.failures.length) throw new Error(`flow 5 failed:\n${trail.report()}`);
  return events;
}
