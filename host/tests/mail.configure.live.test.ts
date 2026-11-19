// The email setup capabilities through the real invoke pipeline: the real definitions from the registry, the real kernel authorize over a real access snapshot, and the real Gate hook.
// mail.configure routes to these, so they are its whole door: a member without comms.domains is refused, an admin is let in, and when an agent changes the Space's mail server or moves an address the call is held for a person's ok.
import { wantsFromInput } from "../../lib/hold-words.ts";
import { sourceKeyHost, uploadFingerprint } from "../../lib/key-target.ts";
import { siteFacts } from "../../modules/sites/impl.ts";
import { world as sitesWorld, h as siteH } from "../../modules/sites/fixtures/deploy-world.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createIdempotency } from "../../kernel/src/idempotency/index.ts";
import { registry } from "../../generated/registry.ts";
import { createGateHook, keySendOf, moduleWhens } from "../src/daemon/gate-hook.ts";
import { createInvoke, createRateLimiter, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, Handler, InvokeDeps } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import { CONFIGURE_ROUTE } from "../../modules/mail/handlers/setup.ts";
import { allowKeyHost, keyHostApproved } from "../../modules/automations/key-hosts.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

// the callees come from mail.configure's own routing table (minus the test email, which goes through mail.send and has its own tests), so a new action is checked the day it is added
const CALLEES = Object.values(CONFIGURE_ROUTE).filter((n) => n !== "mail.setup.test_send");
// the reroutes an agent could use instead of the tool are held the same way: asked through the pipeline they are parked, not run
const REROUTES = ["mail.route.set", "mail.route.remove", "mail.domain.add", "mail.domain.set_default"];
// the provider-level writes an agent could reach around the mail capabilities, and the one setting that decides how the Space sends
const PROVIDER = [
  "mailgun.routes.create",
  "mailgun.domains.create",
  "resend.domains.create",
  "settings.set_space",
  "settings.reset_space",
];
// wording, sync switches and connecting a mailbox, held for an agent too
const MORE = [
  "mail.template.save",
  "mail.template.reset",
  "mail.templates",
  "mail.mailbox.pause",
  "mail.mailbox.resume",
  "mail.mailbox.set_sync_state",
  "mail.connect",
  "google.user.complete",
  "ms.user.complete",
];
// where calls, texts, voicemail and events go: a phone number's route, hours and recording, a live call sent elsewhere, a webhook address
const COMMS = [
  "telephony.number.set_route",
  "telephony.number.set_hours",
  "telephony.number.set_recording",
  "telephony.transfer",
  "webhooks.create",
  "webhooks.update",
  "twilio.number.configure",
  "members.invites.create",
  "members.invites.extend",
  "members.join_link.create",
  "members.join_requests.approve",
  "members.reactivate",
  "members.suspend",
  "members.joins.retry",
  "access.requests.approve",
  "engine.subscription_share.set",
  "memory.promotion.approve",
  "meetings.closeout.approve",
  "chat.approve_plan",
  "changesets.approve",
  "access.actors.create",
  "access.exceptions.set",
  "access.policies.set",
  "spaces.transfer_ownership",
];
// a Vault key sent to a host the call names
const KEYED = [
  "sync_specs.sample",
  "sync_specs.survey",
  "sync_specs.validate",
  "sites.create",
  "sites.update",
  "sites.plan",
  "sites.deploy",
  "sites.ship",
  "sites.env_set",
  "sites.preview_promote",
  "sites.webhook_set",
];
const defs = [...CALLEES, ...REROUTES, ...PROVIDER, ...MORE, ...COMMS, ...KEYED].map(
  (n) => registry.capabilities.find((c) => c.name === n) as unknown as CapabilityDef,
);

function world(sites: readonly string[] = []): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "dom_1", type: "domain", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "num_1", type: "number", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "fld_1", type: "folder", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "rec_1", type: "record", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "thr_1", type: "thread", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "chg_1", type: "changeset", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "mbx_a", type: "mailbox", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  for (const id of ["sit_1", ...sites])
    s.putResource({ id, type: "site", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putRole({ id: "member", clearance: 2, perms: [], name: "Member" });
  s.putRole({
    id: "admin",
    clearance: 3,
    perms: [
      "comms.domains",
      "policy.manage",
      "comms.templates",
      "comms.numbers",
      "connectors.manage",
      "members.invite",
      "members.remove",
      "records.edit",
      "access.manage",
      "sites.deploy",
    ],
    name: "Admin",
  });
  s.putRole({
    id: "mailer",
    clearance: 2,
    perms: [
      "comms.domains",
      "policy.manage",
      "comms.templates",
      "comms.numbers",
      "connectors.manage",
      "members.invite",
      "members.remove",
      "records.edit",
      "access.manage",
      "sites.deploy",
    ],
    name: "Mailer",
  }); // an agent never holds Admin or Owner, so the one it has is a plain role that carries the permission
  for (const [id, role, level] of [
    ["usr_member", "member", "edit"],
    ["usr_admin", "admin", "manage"],
  ] as const) {
    s.putPrincipal({ id, kind: "person", status: "active", name: id });
    s.addPrincipalRole({ holder: id, role });
    s.putGrant({
      id: `g_${id}`,
      subject_kind: "role",
      subject_id: role,
      resource_type: "space",
      resource_id: "spc_1",
      level,
      source: `role:${role}`,
    });
  }
  // an agent that works for the admin, with its own grant on the Space
  s.putPrincipal({ id: "agt_bot", kind: "agent", owner: "usr_admin", status: "active", name: "Bot" });
  s.addPrincipalRole({ holder: "agt_bot", role: "mailer" });
  s.putGrant({
    id: "g_bot",
    subject_kind: "actor",
    subject_id: "agt_bot",
    resource_type: "space",
    resource_id: "spc_1",
    level: "manage",
  });
  // the Google and Microsoft syncs' own calls run as a service, not as an agent
  s.putPrincipal({ id: "svc_sync", kind: "svc", owner: "usr_admin", status: "active", name: "Sync" });
  s.addPrincipalRole({ holder: "svc_sync", role: "mailer" });
  s.putGrant({
    id: "g_svc",
    subject_kind: "actor",
    subject_id: "svc_sync",
    resource_type: "space",
    resource_id: "spc_1",
    level: "manage",
  });
  return s;
}

interface RigOptions {
  /** the real sites a test made: the access snapshot knows them */
  siteIds?: readonly string[];
  /** the Gate's own reads and the reads it makes as a person (the Vault's approved hosts, an agent's right to use an item) */
  exports?: ReadonlyMap<string, Record<string, unknown>>;
  db?: () => {
    all(sql: string, ...a: unknown[]): unknown[];
    run(sql: string, ...a: unknown[]): { changes: number };
  } | null;
  call?: (cap: string, input: unknown) => Promise<unknown>;
  callAs?: (cap: string, input: unknown, person: string) => Promise<unknown>;
}
function rig(o: RigOptions = {}) {
  const snap = world(o.siteIds);
  const ran: string[] = [];
  const parked: { cap: string; act: string }[] = [];
  const handlers: Record<string, Handler> = Object.fromEntries(
    [...CALLEES, ...REROUTES, ...PROVIDER, ...MORE, ...COMMS, ...KEYED].map((n) => [
      n,
      (async () => (ran.push(n), {})) as Handler,
    ]),
  );
  // the sign-in callbacks make the person's mailbox with mail.connect through the same call chain, as the person who is signing in
  for (const n of ["google.user.complete", "ms.user.complete"])
    handlers[n] = (async (ctx: { call: (cap: string, input: unknown) => Promise<unknown> }) => (
      ran.push(n),
      await ctx.call("mail.connect", {
        provider: n.startsWith("google") ? "google" : "microsoft",
        address: "pat@north.example",
        connectionId: `${n.startsWith("google") ? "gua" : "mua"}_${"0".repeat(32)}`,
        idempotencyKey: `c-${n}`,
      })
    )) as unknown as Handler;
  const store = new Map<string, { hash: string; result: unknown }>();
  const gate = createGateHook({
    call: async (cap, input) =>
      cap === "gate.effective_rule" ? { hold: true } : ((await o.call?.(cap, input)) ?? null),
    unseal: () => new Uint8Array(),
    now: () => 0,
    hold: () => null,
    evaluators: moduleWhens(
      o.exports ?? new Map(),
      (o.db ?? (() => null)) as never,
      async (cap, input) => (await o.call?.(cap, input)) ?? null,
      o.callAs,
    ),
  });
  const park = gate.park;
  gate.park = async (a) => {
    parked.push({ cap: a.cap.name, act: a.act });
    void park;
    return { taskId: "tsk_1", runId: "run_1" };
  };
  const deps = {
    caps: indexCapabilities(defs),
    validateInput: () => [],
    authorize: (req: Parameters<InvokeDeps["authorize"]>[0]) => authorize(snap, req),
    handler: (c: string) => handlers[c],
    commit: async (b: { events: object[] }) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    audit: () => {},
    publish: () => {},
    idem: (() => {
      const i = createIdempotency({
        get: (k) => store.get(k) ?? null,
        put: (k, _p, _c, rec) => void store.set(k, rec as { hash: string; result: unknown }),
      });
      return { once: (...a: Parameters<typeof i.once>) => i.once(...a) };
    })(),
    rate: createRateLimiter(),
    onSpan: () => {},
    log: { debug() {}, info() {}, warn() {}, error() {} },
    now: () => 1_000,
    gate,
  } as unknown as InvokeDeps;
  return {
    invoke: createInvoke(deps),
    ran,
    parked,
    gate,
    defOf: (name: string) => defs.find((d) => d.name === name) as CapabilityDef,
  };
}
const seed = (id: string, kind: "person" | "agent" | "service" = "person", extra: Partial<CtxSeed> = {}): CtxSeed =>
  ({ space: "spc_1", principal: { kind, id }, ...extra }) as CtxSeed;
const INPUT: Record<string, Record<string, unknown>> = {
  "mail.setup.status": {},
  "mail.smtp.get": {},
  "mail.smtp.set": { host: "smtp.northwind.example", port: 587, username: "hello", passwordHandle: "#Smtp_Password" },
  "mail.smtp.verify": { idempotencyKey: "k3" },
  "mail.address.list": {},
  "mail.address.add": { domainId: "dom_1", localPart: "billing", idempotencyKey: "k1" },
  "mail.route.set": { domainId: "dom_1", localPart: "*", mailboxId: "mbx_b", idempotencyKey: "k4" },
  "mail.route.remove": { routeId: "rte_1", domainId: "dom_1" },
  "mail.domain.add": { name: "north.example", provider: "resend", idempotencyKey: "k5" },
  "mail.domain.set_default": { domainId: "dom_1" },
  "mailgun.routes.create": { expression: 'match_recipient(".*@north.example")', idempotencyKey: "k6" },
  "mailgun.domains.create": { name: "north.example", idempotencyKey: "k7" },
  "resend.domains.create": { name: "north.example", idempotencyKey: "k8" },
  "settings.set_space": { key: "mail.provider", value: "smtp" },
  "settings.reset_space": { key: "mail.provider" },
  "mail.template.save": { key: "welcome", subject: "Hi", text: "Hello", idempotencyKey: "k9" },
  "mail.template.reset": { key: "welcome", idempotencyKey: "k10" },
  "mail.templates": { action: "set", key: "welcome", subject: "Hi", text: "Hello" },
  "mail.mailbox.pause": { mailboxId: "mbx_a" },
  "mail.mailbox.resume": { mailboxId: "mbx_a" },
  "mail.mailbox.set_sync_state": { mailboxId: "mbx_a", state: "error" },
  "mail.connect": { provider: "google", address: "pat@north.example", idempotencyKey: "k11" },
  "google.user.complete": { state: "s", code: "c" },
  "ms.user.complete": { state: "s", code: "c" },
  "telephony.number.set_route": {
    numberId: "num_1",
    route: { ring: [{ kind: "external", e164: "+15550100" }], seconds: 20, voicemail: true },
  },
  "telephony.number.set_hours": { numberId: "num_1", hours: { always: true } },
  "telephony.number.set_recording": { numberId: "num_1", recording: { mode: "off" } },
  "telephony.transfer": { callId: "call_1", to: "+15550100" },
  "webhooks.create": {
    name: "hook",
    url: "https://attacker.example/in",
    eventTypes: ["record.created"],
    idempotencyKey: "k20",
  },
  "members.invites.create": { role: "rol_member", email: "pat@outside.example", idempotencyKey: "k22" },
  "members.invites.extend": { inviteId: "inv_1", expiresInDays: 30 },
  "members.join_link.create": { role: "rol_member" },
  "members.join_requests.approve": { requestId: "jrq_1" },
  "members.reactivate": { personId: "usr_member" },
  "members.suspend": { personId: "usr_member" },
  "members.joins.retry": { personId: "usr_member" },
  "access.requests.approve": { requestId: "arq_1" },
  "engine.subscription_share.set": { enabled: true },
  "memory.promotion.approve": { promotionId: "mpr_1" },
  "meetings.closeout.approve": { meetingId: "rec_1" },
  "chat.approve_plan": { threadId: "thr_1", planId: "pln_1" },
  "changesets.approve": { changesetId: "chg_1", idempotencyKey: "k30" },
  "access.actors.create": { name: "Outside", provider: "anthropic", idempotencyKey: "k31" },
  "access.exceptions.set": { exceptionId: "exc_1", idempotencyKey: "k32" },
  "access.policies.set": { key: "gate.send", scope: "space", value: {}, idempotencyKey: "k33" },
  "spaces.transfer_ownership": { to: "usr_member", idempotencyKey: "k34" },
  "webhooks.update": { webhookId: "whk_1", url: "https://attacker.example/in" },
  "twilio.number.configure": { sid: "PN1", voiceUrl: "https://attacker.example/voice", idempotencyKey: "k21" },
  "mail.address.move": {
    domainId: "dom_1",
    localPart: "billing",
    fromMailboxId: "mbx_a",
    mailboxId: "mbx_b",
    idempotencyKey: "k2",
  },
};
assert.deepEqual(
  CALLEES.filter((n) => !(n in INPUT)),
  [],
  "every callee has an example input here: add one for a new action",
);
const codeOf = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "",
    (e) => (e instanceof HostError ? e.error.code : String(e)),
  );

test("through the real invoke pipeline: a member without comms.domains is refused on every setup capability, and an admin is let in", async () => {
  for (const name of CALLEES) {
    const r = rig();
    assert.equal(
      await codeOf(r.invoke(name, { ...INPUT[name] }, seed("usr_member"))),
      "permission.role_lacks_permission",
      `${name}: a member is refused`,
    );
    assert.deepEqual(r.ran, [], `${name}: the handler never ran for a member`);
    const ok = await rig().invoke(name, { ...INPUT[name] }, seed("usr_admin"));
    assert.equal(ok.status, "ok", `${name}: an admin with comms.domains is let in`);
  }
});

test("through the real Gate: an agent changing the mail server or moving an address is held for a person's ok, a person's own change is one step, and reads are not held", async () => {
  for (const name of ["mail.smtp.set", "mail.address.move", ...REROUTES]) {
    const asAgent = rig();
    const held = await asAgent
      .invoke(name, { ...INPUT[name] }, seed("agt_bot", "agent", { actingFor: "usr_admin" }))
      .catch((e: unknown) => {
        throw new Error(
          `${name}: ${e instanceof HostError ? JSON.stringify(e.error.details ?? e.error.code) : String(e)}`,
        );
      });
    assert.equal(held.status, "held", `${name}: an agent is held`);
    assert.deepEqual(asAgent.parked, [{ cap: name, act: "send" }]);
    assert.deepEqual(asAgent.ran, [], `${name}: nothing ran before a person said yes`);
    const asPerson = rig();
    const one = await asPerson.invoke(name, { ...INPUT[name] }, seed("usr_admin")).catch((e: unknown) => {
      throw new Error(
        `${name} as a person: ${e instanceof HostError ? JSON.stringify(e.error.details ?? e.error.code) : String(e)}`,
      );
    });
    assert.equal(one.status, "ok", `${name}: a person's own change is one step`);
    assert.deepEqual(asPerson.parked, []);
  }
  const read = rig();
  assert.equal(
    (await read.invoke("mail.smtp.get", {}, seed("agt_bot", "agent", { actingFor: "usr_admin" }))).status,
    "ok",
  );
  assert.deepEqual(read.parked, []);
});

test("through the real Gate: a provider-level route or domain write, and the mail.provider setting, are held for an agent and nothing runs; every other setting goes straight through", async () => {
  for (const name of [
    "mailgun.routes.create",
    "mailgun.domains.create",
    "resend.domains.create",
    "settings.set_space",
    "settings.reset_space",
  ]) {
    const asAgent = rig();
    const held = await asAgent
      .invoke(name, { ...INPUT[name] }, seed("agt_bot", "agent", { actingFor: "usr_admin" }))
      .catch((e: unknown) => {
        throw new Error(`${name}: ${e instanceof HostError ? JSON.stringify(e.error) : String(e)}`);
      });
    assert.equal(held.status, "held", `${name}: an agent is held`);
    assert.deepEqual(asAgent.parked, [{ cap: name, act: actOfCap(name) }]);
    assert.deepEqual(asAgent.ran, [], `${name}: nothing ran before a person said yes`);
    const asPerson = rig();
    const one = await asPerson.invoke(name, { ...INPUT[name] }, seed("usr_admin")).catch((e: unknown) => {
      throw new Error(`${name} as a person: ${e instanceof HostError ? JSON.stringify(e.error) : String(e)}`);
    });
    assert.equal(one.status, "ok", `${name}: a person's own change is one step`);
  }
  const other = rig();
  assert.equal(
    (
      await other.invoke(
        "settings.set_space",
        { key: "profile.timezone", value: "UTC" },
        seed("agt_bot", "agent", { actingFor: "usr_admin" }),
      )
    ).status,
    "ok",
    "an agent's change to another setting is not held",
  );
  assert.deepEqual(other.parked, []);
});

test("through the real Gate: wording, sync switches and connecting a mailbox are held for an agent; testing the saved mail server is open, and a server a caller names is held", async () => {
  const agent = (id = "agt_bot") => seed(id, "agent", { actingFor: "usr_admin" });
  for (const name of [
    "mail.template.save",
    "mail.template.reset",
    "mail.templates",
    "mail.mailbox.pause",
    "mail.mailbox.resume",
    "mail.mailbox.set_sync_state",
    "mail.connect",
  ]) {
    const r = rig();
    assert.equal((await r.invoke(name, { ...INPUT[name] }, agent())).status, "held", `${name}: an agent is held`);
    assert.deepEqual(r.ran, [], `${name}: nothing ran`);
    assert.equal(
      (await rig().invoke(name, { ...INPUT[name] }, seed("usr_admin"))).status,
      "ok",
      `${name}: a person is one step`,
    );
  }
  // the tool's reads are not held, only its writes
  const read = rig();
  assert.equal((await read.invoke("mail.templates", { action: "list" }, agent())).status, "ok");
  assert.deepEqual(read.parked, []);
  // testing the saved mail server sends a sign-in to a place the person gave: open; naming a server, a port, a username or a password handle is held for an agent
  const saved = rig();
  assert.equal((await saved.invoke("mail.smtp.verify", { idempotencyKey: "v0" }, agent())).status, "ok");
  assert.deepEqual(saved.parked, []);
  for (const override of [
    { host: "attacker.example" },
    { port: 2525 },
    { username: "x" },
    { passwordHandle: "#Smtp_Password" },
    { host: "attacker.example", passwordHandle: "#Smtp_Password" },
  ]) {
    const r = rig();
    assert.equal(
      (await r.invoke("mail.smtp.verify", { ...override, idempotencyKey: "v1" }, agent())).status,
      "held",
      `verify with ${Object.keys(override).join(", ")} is held for an agent`,
    );
    assert.deepEqual(r.ran, []);
  }
  // a person's own test of a typed server is one step here (the handler refuses a saved password sent elsewhere: smtp.test)
  assert.equal(
    (
      await rig().invoke(
        "mail.smtp.verify",
        { host: "smtp.other.example", passwordHandle: "#Smtp_New", idempotencyKey: "v2" },
        seed("usr_admin"),
      )
    ).status,
    "ok",
  );
});

test("through the real Gate: a person finishing a Google or Microsoft sign-in makes their mailbox in one step with no approval task, and an agent calling mail.connect is still held", async () => {
  for (const name of ["google.user.complete", "ms.user.complete"]) {
    const r = rig();
    const done = await r.invoke(name, { ...INPUT[name] }, seed("usr_admin"));
    assert.equal(done.status, "ok", `${name}: the person's sign-in completes`);
    assert.deepEqual(r.parked, [], `${name}: no approval task was made for the person's own mailbox`);
    assert.deepEqual(
      r.ran,
      [name, "mail.connect"].sort((a, b) => (a === name ? -1 : b === name ? 1 : 0)),
      `${name}: and mail.connect ran inside it`,
    );
  }
  const bot = rig();
  assert.equal(
    (
      await bot.invoke(
        "mail.connect",
        { ...INPUT["mail.connect"] },
        seed("agt_bot", "agent", { actingFor: "usr_admin" }),
      )
    ).status,
    "held",
  );
  assert.deepEqual(bot.ran, []);
});

test("through the real Gate: the sync's own pause, resume and sync-state calls (a service) stay one step, while an agent's are held", async () => {
  for (const name of ["mail.mailbox.pause", "mail.mailbox.resume", "mail.mailbox.set_sync_state"]) {
    const sync = rig();
    const done = await sync.invoke(name, { ...INPUT[name] }, {
      space: "spc_1",
      principal: { kind: "service", id: "svc_sync" },
    } as CtxSeed);
    assert.equal(done.status, "ok", `${name}: the sync is not held`);
    assert.deepEqual(sync.parked, []);
    assert.equal(
      (await rig().invoke(name, { ...INPUT[name] }, seed("agt_bot", "agent", { actingFor: "usr_admin" }))).status,
      "held",
      `${name}: an agent is held`,
    );
  }
});

test("through the real Gate: an agent changing where calls, texts, voicemail or events go is parked and nothing runs (a number's route, hours or recording, a live call sent to another number, a webhook address); a person's own change is one step", async () => {
  for (const name of COMMS) {
    const asAgent = rig();
    const held = await asAgent
      .invoke(name, { ...INPUT[name] }, seed("agt_bot", "agent", { actingFor: "usr_admin" }))
      .catch((e: unknown) => {
        throw new Error(`${name}: ${e instanceof HostError ? JSON.stringify(e.error) : String(e)}`);
      });
    assert.equal(held.status, "held", `${name}: an agent is held`);
    assert.deepEqual(asAgent.parked, [{ cap: name, act: actOfCap(name) }]);
    assert.deepEqual(asAgent.ran, [], `${name}: nothing ran before a person said yes`);
    const asPerson = rig();
    assert.equal(
      (await asPerson.invoke(name, { ...INPUT[name] }, seed("usr_admin"))).status,
      "ok",
      `${name}: a person's own change is one step`,
    );
    assert.deepEqual(asPerson.parked, []);
  }
});

test("through the real Gate: an invitation by an agent is held unless the person gave the setup grant, which names invites; a person is one step", async () => {
  const input = { ...INPUT["members.invites.create"] };
  const r = rig();
  assert.equal(
    (await r.invoke("members.invites.create", input, seed("agt_bot", "agent", { actingFor: "usr_admin" }))).status,
    "held",
  );
  const at = async (principal: { kind: string; id: string }): Promise<unknown> =>
    await r.gate.applies(r.defOf("members.invites.create"), input, { space: "spc_1", principal } as never);
  assert.equal(
    await at({ kind: "service", id: "svc_host" }),
    null,
    "the host's own service (the seed, the join flow) is not an actor",
  );
  assert.deepEqual(await at({ kind: "service", id: "aut_1" }), { act: "admit" }, "an Automation step is held");
  assert.deepEqual(await at({ kind: "actor", id: "act_1" }), { act: "admit" }, "an outside actor is held");
  const granted = rig();
  assert.equal(
    (
      await granted.invoke(
        "members.invites.create",
        input,
        seed("agt_bot", "agent", { actingFor: "usr_admin", setupGrant: true }),
      )
    ).status,
    "ok",
    "the setup grant said yes ahead of time for invites",
  );
});

// ---- a Vault key sent to a host a call names: the key-host rule (approved hosts), for sync specs, sample reads and a site's git repo

const SAMPLE = (domain: string, handle = "#Crm_Key") => ({
  auth: { vaultHandle: handle, style: "bearer" },
  domain,
  path: "/contacts",
});
function keyWorld(access: "allow" | "deny" = "allow") {
  const hosts: { item_id: string; host: string; by: string; at: number }[] = [];
  const db = {
    all: (sql: string, ...a: unknown[]): unknown[] => {
      if (sql.includes("vault_meta"))
        return [{ id: "vit_crm", handle: "#Crm_Key", name: "Crm", scope: "shared", owner: "usr_admin" }];
      if (sql.includes("automations_key_hosts")) return hosts.filter((h) => h.item_id === a[0] && h.host !== "");
      return [];
    },
    run: (_sql: string, ...a: unknown[]) => (
      hosts.push({ item_id: String(a[0]), host: String(a[1]), by: String(a[2]), at: Number(a[3]) }),
      { changes: 1 }
    ),
  };
  return {
    hosts,
    opts: {
      exports: new Map([["automations", { keyHostApproved }]]),
      db: () => db,
      call: async (cap: string) => (cap === "access.check" ? { decision: { effect: access } } : null),
      callAs: async (cap: string, input: unknown, person: string) => {
        if (cap === "automations.key_hosts.allow") {
          const i = input as { vaultItemId: string; host: string };
          allowKeyHost(db, i.vaultItemId, i.host, person, 1);
          return {};
        }
        return { items: [] };
      },
    } satisfies RigOptions,
  };
}
/** The act a capability's own manifest names for its Gate. */
const actOfCap = (name: string): string =>
  (registry.capabilities.find((c) => c.name === name) as unknown as { gate?: { act?: string } }).gate?.act ?? "";
const asAgent = (id = "agt_bot") => seed(id, "agent", { actingFor: "usr_admin" });

test("through the real Gate: an agent sending a Vault key to a new host is held, a person's approval makes that host flow next time, a different host is held again, and a person is one step", async () => {
  const w = keyWorld();
  // a person is one step, to any host
  const person = rig(w.opts);
  assert.equal((await person.invoke("sync_specs.sample", SAMPLE("api.crm.example"), seed("usr_admin"))).status, "ok");
  assert.deepEqual(person.parked, []);
  // an agent with a host nobody approved: held, nothing runs
  const first = rig(w.opts);
  assert.equal((await first.invoke("sync_specs.sample", SAMPLE("api.crm.example"), asAgent())).status, "held");
  assert.deepEqual(first.parked, [{ cap: "sync_specs.sample", act: "send" }]);
  assert.deepEqual(first.ran, []);
  // the person says yes: the call runs on their approval and the host is approved for that item from now on
  const approved = rig(w.opts);
  await approved.gate.seen?.(
    approved.defOf("sync_specs.sample"),
    SAMPLE("api.crm.example"),
    {},
    { ...asAgent(), approval: "apv_yes" },
    0,
  );
  assert.deepEqual(
    w.hosts.filter((h) => h.host !== "").map((h) => [h.item_id, h.host, h.by]),
    [["vit_crm", "api.crm.example", "usr_admin"]],
    "the approving person's host is recorded for that item",
  );
  const next = rig(w.opts);
  assert.equal(
    (await next.invoke("sync_specs.sample", SAMPLE("api.crm.example"), asAgent())).status,
    "ok",
    "the same host now flows",
  );
  assert.deepEqual(next.parked, []);
  // a different host is held again, and so are survey, a spec and a site's repo
  const other = rig(w.opts);
  assert.equal((await other.invoke("sync_specs.sample", SAMPLE("api.elsewhere.example"), asAgent())).status, "held");
  const spec = {
    spec: { app: { name: "Crm", domain: "api.elsewhere.example" }, auth: { vaultHandle: "#Crm_Key", style: "bearer" } },
  };
  assert.equal((await rig(w.opts).invoke("sync_specs.validate", spec, asAgent())).status, "held");
  assert.equal(
    (await rig(w.opts).invoke("sync_specs.survey", { ...SAMPLE("api.elsewhere.example"), paths: ["/a"] }, asAgent()))
      .status,
    "held",
  );
  const site = rig(w.opts);
  assert.deepEqual(
    await site.gate.applies(
      site.defOf("sites.create"),
      { name: "s", source: { repo: "https://git.elsewhere.example/a/b", tokenHandle: "#Crm_Key" } },
      { ...asAgent() } as never,
    ),
    { act: "send" },
    "a site's git repo on a new host is held for an agent",
  );
  assert.equal(
    await site.gate.applies(
      site.defOf("sites.create"),
      { name: "s", source: { repo: "https://git.elsewhere.example/a/b", tokenHandle: "#Crm_Key" } },
      { ...seed("usr_admin") } as never,
    ),
    null,
    "and a person is one step",
  );
  // a deploy, a plan and an update that name a repo and a key are held the same way
  for (const name of ["sites.update", "sites.plan", "sites.deploy", "sites.ship"])
    assert.deepEqual(
      await site.gate.applies(
        site.defOf(name),
        { siteId: "sit_1", source: { repo: "https://git.elsewhere.example/a/b", tokenHandle: "#Crm_Key" } },
        { ...asAgent() } as never,
      ),
      { act: "send" },
      `${name}: a repo on a new host is held for an agent`,
    );
  // a Vault key given to a site as env runs inside code an agent may have chosen: held for an agent, with or without a token, on any host; plain values and a person are one step
  const envOf = (entries: unknown[]) => ({ siteId: "sit_1", entries });
  assert.deepEqual(
    await site.gate.applies(site.defOf("sites.env_set"), envOf([{ name: "K", vaultHandle: "#Stripe_Key" }]), {
      ...asAgent(),
    } as never),
    { act: "send" },
    "env_set with a Vault key is held for an agent",
  );
  assert.equal(
    await site.gate.applies(site.defOf("sites.env_set"), envOf([{ name: "MODE", value: "calm" }]), {
      ...asAgent(),
    } as never),
    null,
    "a plain value is the agent's own",
  );
  assert.equal(
    await site.gate.applies(site.defOf("sites.env_set"), envOf([{ name: "K", vaultHandle: "#Stripe_Key" }]), {
      ...seed("usr_admin"),
    } as never),
    null,
    "a person is one step",
  );
  assert.deepEqual(
    await site.gate.applies(
      site.defOf("sites.ship"),
      { name: "s", source: { repo: "https://github.com/a/b" }, env: [{ name: "K", vaultHandle: "#Stripe_Key" }] },
      { ...asAgent() } as never,
    ),
    { act: "send" },
    "ship with a Vault key in env is held even for a public repo with no token",
  );
  assert.deepEqual(
    await site.gate.applies(
      site.defOf("sites.ship"),
      {
        name: "s",
        source: { repo: "acme/app", tokenHandle: "#Crm_Key" },
        env: [{ name: "K", vaultHandle: "#Stripe_Key" }],
      },
      { ...asAgent() } as never,
    ),
    { act: "send" },
    "an approved token host does not carry a second key in env through",
  );
  // a call that names no key is not touched by the rule
  assert.equal(keySendOf({ name: "s" }), undefined);
  assert.equal(keySendOf({ name: "s", source: { repo: "acme/app", tokenHandle: "#T" } })?.host, "github.com");
});

const NEW_REPO = {
  folderId: "fld_1",
  name: "site",
  source: { repo: "https://git.elsewhere.example/a/b", tokenHandle: "#Crm_Key" },
  idempotencyKey: "site-1",
};
test("through a full invoke: sites.create with a repo on a new host is parked and nothing is created; after a person's yes the same host goes through; a person is one step", async () => {
  const w = keyWorld();
  const first = rig(w.opts);
  assert.equal((await first.invoke("sites.create", { ...NEW_REPO }, asAgent())).status, "held");
  assert.deepEqual([first.parked, first.ran], [[{ cap: "sites.create", act: "send" }], []]);
  const approved = rig(w.opts);
  await approved.gate.seen?.(
    approved.defOf("sites.create"),
    NEW_REPO,
    {},
    { ...asAgent(), approval: "apv_yes", approvedBy: "usr_member" } as never,
    0,
  );
  assert.deepEqual(
    w.hosts.filter((h) => h.host !== "").map((h) => [h.item_id, h.host, h.by]),
    [["vit_crm", "git.elsewhere.example", "usr_member"]],
    "the host is recorded as approved by the person who pressed yes, not the person the agent works for",
  );
  const next = rig(w.opts);
  assert.equal((await next.invoke("sites.create", { ...NEW_REPO, idempotencyKey: "site-2" }, asAgent())).status, "ok");
  assert.deepEqual([next.parked, next.ran], [[], ["sites.create"]]);
  const person = rig(w.opts);
  assert.equal(
    (await person.invoke("sites.create", { ...NEW_REPO, idempotencyKey: "site-3" }, seed("usr_admin"))).status,
    "ok",
  );
});

test("through a full invoke: sites.ship with a repo on a new host is parked; after a person's yes the same host goes through and the card names the key and the host; a person is one step", async () => {
  const w = keyWorld();
  const ship = { name: "site", source: { repo: "https://git.elsewhere.example/a/b", tokenHandle: "#Crm_Key" } };
  const first = rig(w.opts);
  assert.equal((await first.invoke("sites.ship", { ...ship }, asAgent())).status, "held");
  assert.deepEqual([first.parked, first.ran], [[{ cap: "sites.ship", act: "send" }], []]);
  const approved = rig(w.opts);
  await approved.gate.seen?.(
    approved.defOf("sites.ship"),
    ship,
    {},
    { ...asAgent(), approval: "apv_ship_yes", approvedBy: "usr_member" } as never,
    0,
  );
  assert.deepEqual(
    w.hosts.filter((h) => h.host === "git.elsewhere.example").map((h) => [h.item_id, h.by]),
    [["vit_crm", "usr_member"]],
    "ship records the approved host like create does",
  );
  const next = rig(w.opts);
  assert.equal((await next.invoke("sites.ship", { ...ship }, asAgent())).status, "ok");
  assert.deepEqual([next.parked, next.ran], [[], ["sites.ship"]]);
  assert.equal((await rig(w.opts).invoke("sites.ship", { ...ship }, seed("usr_admin"))).status, "ok");
});

const STORED = { name: "K", handle: "#Crm_Key" };
const SRC = (repo: string, branch = "", root = ""): Promise<string> =>
  sourceKeyHost(`git:${JSON.stringify([`https://github.com/${repo.toLowerCase()}`, branch, root])}`);
test("a Vault key given to a site as env: held for an agent unless a person approved that key for that source; after a yes the same source flows, another source is held again, a person is one step", async () => {
  const w = keyWorld();
  const env = [{ name: "K", vaultHandle: "#Crm_Key" }];
  const ship = (repo: string) => ({ name: "site", source: { repo }, env });
  const first = rig(w.opts);
  assert.equal(
    (await first.invoke("sites.ship", ship("acme/app"), asAgent())).status,
    "held",
    "a public repo, no token: held",
  );
  assert.deepEqual([first.parked, first.ran], [[{ cap: "sites.ship", act: "send" }], []]);
  // the person says yes: the key is approved for that source
  const approved = rig(w.opts);
  await approved.gate.seen?.(
    approved.defOf("sites.ship"),
    ship("acme/app"),
    {},
    { ...asAgent(), approval: "apv_env_yes", approvedBy: "usr_member" } as never,
    0,
  );
  assert.deepEqual(
    w.hosts.filter((h) => h.host !== "").map((h) => [h.item_id, h.host, h.by]),
    [["vit_crm", await SRC("acme/app"), "usr_member"]],
    "the pair (key, source) is recorded, by the person who pressed yes",
  );
  const next = rig(w.opts);
  assert.equal(
    (await next.invoke("sites.ship", ship("acme/app"), asAgent())).status,
    "ok",
    "the same source and key go through",
  );
  assert.equal(
    (await next.invoke("sites.ship", ship("https://github.com/Acme/App.git"), asAgent())).status,
    "ok",
    "however the repo is written",
  );
  const other = rig(w.opts);
  assert.equal(
    (await other.invoke("sites.ship", ship("acme/other"), asAgent())).status,
    "held",
    "another repo is held again",
  );
  assert.equal((await other.invoke("sites.ship", ship("evil/app"), asAgent())).status, "held", "and another owner");
  const person = rig(w.opts);
  assert.equal(
    (await person.invoke("sites.ship", ship("evil/app"), seed("usr_admin"))).status,
    "ok",
    "a person is one step",
  );
});

/** One file in the fake Files tree: the id and version that Files hands out, and where it sits. */
type FileRow = { fileId: string; name: string; version: number; size: number };
/**
 * A world with REAL sites: the real sites handlers over a real SQLite with the sites migrations (create, deploy, preview, update), the real `siteFacts` the Gate reads, and Files faked as the person the call is for.
 * No facts are written by hand: a test makes a site, deploys it, stores keys the way env_set does, and then an agent calls.
 */
function siteWorld() {
  const w = keyWorld();
  const tree: { files: Record<string, FileRow[]>; folders: Record<string, { folderId: string; name: string }[]> } = {
    files: { fld_up: [{ fileId: "fil_a", name: "index.html", version: 1, size: 10 }] },
    folders: {},
  };
  const state = { fetchFp: undefined as string | undefined, readable: true };
  const filesAnswer = (cap: string, input: unknown): unknown => {
    if (!state.readable) return null;
    const i = input as { folder?: string; fileId?: string; cursor?: string; limit?: number };
    if (cap === "files.list") {
      const all = tree.files[i.folder as string];
      if (!all) return null;
      // pages, as Files gives them: the cursor is where the next page starts
      const from = Number(i.cursor ?? 0);
      const to = Math.min(all.length, from + (i.limit ?? 500));
      return {
        files: all.slice(from, to),
        folders: from === 0 ? (tree.folders[i.folder as string] ?? []) : [],
        ...(to < all.length ? { next: String(to) } : {}),
      };
    }
    if (cap === "files.get") {
      const f = Object.values(tree.files)
        .flat()
        .find((x) => x.fileId === i.fileId);
      return f ? { file: f } : null;
    }
    return null;
  };
  const sw = sitesWorld({ files: filesAnswer, fetchFp: () => state.fetchFp });
  const kdb = (
    w.opts.db as () => {
      all(s: string, ...a: unknown[]): unknown[];
      run(s: string, ...a: unknown[]): { changes: number };
    }
  )();
  const keyed = (sql: string): boolean => /vault_meta|automations_key_hosts/.test(sql);
  const db = {
    all: (sql: string, ...a: unknown[]) => (keyed(sql) ? kdb.all(sql, ...a) : sw.sdb.all(sql, ...a)),
    run: (sql: string, ...a: unknown[]) => (keyed(sql) ? kdb.run(sql, ...a) : sw.sdb.run(sql, ...a)),
  };
  const known: string[] = [];
  const opts = {
    ...w.opts,
    siteIds: known,
    db: () => db,
    callAs: async (cap: string, input: unknown, person: string) =>
      cap.startsWith("files.") ? filesAnswer(cap, input) : w.opts.callAs(cap, input, person),
    exports: new Map<string, Record<string, unknown>>([...w.opts.exports, ["sites", { siteFacts }]]),
  };
  const yes = async (cap: string, input: unknown, n: string): Promise<void> => {
    const r = rig(opts);
    await r.gate.seen?.(r.defOf(cap), input, {}, { ...asAgent(), approval: n, approvedBy: "usr_member" } as never, 0);
  };
  const call = (cap: string, input: Record<string, unknown>) => siteH[cap]!(sw.ctx, input);
  /** What the real create and a real deploy leave behind: a site, its live deployment, and where that was built from. */
  const site = async (name: string, source?: Record<string, unknown>, deploy = true): Promise<string> => {
    const siteId = (await call("sites.create", { name, ...(source ? { source } : {}) })).site.siteId as string;
    known.push(siteId);
    if (deploy) await call("sites.deploy", { siteId, wait: true });
    return siteId;
  };
  /** The keys a site stores, the rows env_set writes for a Vault handle. */
  const store = (siteId: string, name: string, handle: string, scope = "production"): void => {
    sw.sdb.run(
      "INSERT INTO sites_env (site_id, name, vault_handle, injected, plain, scope) VALUES (?, ?, ?, ?, ?, ?)",
      siteId,
      name,
      handle,
      0,
      null,
      scope,
    );
  };
  const keysOff = (siteId: string): void => void sw.sdb.run("DELETE FROM sites_env WHERE site_id = ?", siteId);
  const fp = async (folder = "fld_up"): Promise<string> =>
    (await uploadFingerprint({ folderId: folder }, (cap, i) => filesAnswer(cap, i) as Promise<unknown>)) as string;
  /** A deploy of an uploaded folder as it is now: the build records the fingerprint of what it read. */
  const deployUpload = async (siteId: string): Promise<void> => {
    state.fetchFp = await fp();
    // a deploy fills the stored keys' values from the Vault, which this world does not have: the keys are put back after it
    const kept = sw.sdb.all("SELECT name, vault_handle, scope FROM sites_env WHERE site_id = ?", siteId) as {
      name: string;
      vault_handle: string;
      scope: string;
    }[];
    keysOff(siteId);
    await call("sites.deploy", { siteId, wait: true });
    for (const k of kept) store(siteId, k.name, k.vault_handle, k.scope);
  };
  const agent = async (cap: string, input: unknown): Promise<string> =>
    (await rig(opts).invoke(cap, input, asAgent())).status as string;
  const person = async (cap: string, input: unknown): Promise<string> =>
    (await rig(opts).invoke(cap, input, seed("usr_admin"))).status as string;
  return { w, sw, tree, state, known, opts, yes, call, site, store, keysOff, fp, deployUpload, agent, person };
}
const hostsOf = (s: ReturnType<typeof siteWorld>): string[] =>
  s.w.hosts.filter((h) => h.host !== "").map((h) => h.host);

test("sites_env_set on a real site: a key added is approved for the site's source once; the same key stored is no new pair; another source, a site with no source and an unreadable one are held", async () => {
  const s = siteWorld();
  const siteId = await s.site("App", { repo: "https://github.com/acme/app.git" });
  const add = { siteId, entries: [{ name: "K", vaultHandle: "#Crm_Key" }] };
  assert.equal(await s.agent("sites.env_set", add), "held");
  await s.yes("sites.env_set", add, "apv_e1");
  assert.deepEqual(hostsOf(s), [await SRC("acme/app")]);
  assert.equal(await s.agent("sites.env_set", add), "ok", "approved for that source");
  // the key is stored now: the same env again is nothing new (a ship that re-sends its env never parks a card)
  s.store(siteId, "K", "#Crm_Key");
  s.w.hosts.length = 0;
  assert.equal(await s.agent("sites.env_set", add), "ok");
  // a changed key (the same name, another item) is new
  assert.equal(
    await s.agent("sites.env_set", { siteId, entries: [{ name: "K", vaultHandle: "#Crm_Key.other" }] }),
    "held",
  );
  // the site's files are uploaded files: another source, named by the site id and what the files are
  const up = await s.site("Up", { folderId: "fld_up" });
  const addUp = { siteId: up, entries: [{ name: "K", vaultHandle: "#Crm_Key" }] };
  assert.equal(await s.agent("sites.env_set", addUp), "held");
  await s.yes("sites.env_set", addUp, "apv_e2");
  assert.ok(
    s.w.hosts.some((h) => h.item_id === "vit_crm" && h.host !== ""),
    "uploaded files are approved as their own source",
  );
  assert.equal(await s.agent("sites.env_set", addUp), "ok");
  // a site with no source this can read holds; a plain value and a person are open
  const bare = await s.site("Bare", undefined, false);
  assert.equal(await s.agent("sites.env_set", { siteId: bare, entries: STORED_ENTRY }), "held");
  assert.equal(await s.agent("sites.env_set", { siteId, entries: [{ name: "M", value: "calm" }] }), "ok");
  assert.equal(await s.person("sites.env_set", add), "ok");
  assert.equal(
    wantsFromInput("sites.ship", {
      name: "Dash",
      source: { repo: "https://github.com/acme/app.git" },
      env: add.entries,
    }),
    "give the key Crm_Key to the site Dash, built from acme/app",
  );
});
const STORED_ENTRY = [{ name: "K", vaultHandle: "#Crm_Key" }];

test("a real site with keys stored moved to another source (update, deploy, plan, ship): held until a person approves every stored key for that source; a call that names no source, or the same one, is free", async () => {
  const s = siteWorld();
  const siteId = await s.site("App", { repo: "https://github.com/acme/app.git" });
  s.store(siteId, STORED.name, STORED.handle);
  for (const cap of ["sites.update", "sites.deploy", "sites.plan", "sites.ship"])
    assert.equal(
      await s.agent(cap, { siteId, source: { repo: "https://attacker.example/x.git" } }),
      "held",
      `${cap} to another repo with a stored key is held`,
    );
  const move = { siteId, source: { repo: "evil/app" } };
  assert.equal(await s.agent("sites.update", move), "held", "a public repo, no token");
  await s.yes("sites.update", move, "apv_m1");
  assert.deepEqual(hostsOf(s), [await SRC("evil/app")]);
  assert.equal(await s.agent("sites.update", move), "ok", "after a yes it goes through");
  assert.equal(await s.agent("sites.deploy", move), "ok", "and so does its deploy");
  assert.equal(await s.agent("sites.update", { siteId, source: { repo: "other/app" } }), "held", "another repo again");
  // the move itself (a real update) makes evil/app the site's source; a redeploy with no source, or the same one, never waits
  await s.call("sites.update", { siteId, source: { repo: "evil/app" } });
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok");
  assert.equal(await s.agent("sites.deploy", { siteId, source: { repo: "https://github.com/Evil/App.git" } }), "ok");
  // a site with no keys stored is nothing to protect
  s.keysOff(siteId);
  assert.equal(await s.agent("sites.update", { siteId, source: { repo: "new/one" } }), "ok");
  // a person is one step
  s.store(siteId, STORED.name, STORED.handle);
  assert.equal(await s.person("sites.update", { siteId, source: { repo: "third/app" } }), "ok");
});

test("a branch or folder of the same repo is another source, read from the stored site: an agent that can push a feature branch cannot put the production keys in front of it; a same-branch redeploy is free", async () => {
  const s = siteWorld();
  const siteId = await s.site("App", { repo: "https://github.com/acme/app.git", branch: "main" });
  s.store(siteId, STORED.name, STORED.handle);
  for (const cap of ["sites.deploy", "sites.update", "sites.plan", "sites.ship"])
    assert.equal(
      await s.agent(cap, { siteId, source: { repo: "acme/app", branch: "agent-x" } }),
      "held",
      `${cap}: another branch of the same repo is held`,
    );
  assert.equal(
    await s.agent("sites.deploy", { siteId, source: { repo: "https://github.com/Acme/App.git", branch: "main" } }),
    "ok",
    "the same branch is free",
  );
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok", "no source named is free");
  assert.equal(
    await s.agent("sites.deploy", { siteId, source: { repo: "acme/app", branch: "main", root: "apps/other" } }),
    "held",
    "another folder is another source",
  );
  // the repo alone, with no branch, is not the stored branch either (it would move the site to the repo's default branch)
  assert.equal(await s.agent("sites.update", { siteId, source: { repo: "acme/app" } }), "held");
  const move = { siteId, source: { repo: "acme/app", branch: "agent-x" } };
  await s.yes("sites.deploy", move, "apv_b1");
  assert.deepEqual(hostsOf(s), [await SRC("acme/app", "agent-x")], "the pair is the key and the repo with its branch");
  assert.equal(await s.agent("sites.deploy", move), "ok", "after a yes: that repo and branch");
  assert.equal(
    await s.agent("sites.deploy", { siteId, source: { repo: "acme/app", branch: "agent-y" } }),
    "held",
    "another branch is held again",
  );
  assert.equal(await s.person("sites.deploy", { siteId, source: { repo: "acme/app", branch: "agent-z" } }), "ok");
});

test("promote on a real site: a preview of the production branch is the site's own; a preview of another branch, or of a repo the site moved away from, puts the production keys in front of that code until a person approves each; previews-scope keys are no part of it", async () => {
  const s = siteWorld();
  const siteId = await s.site("App", { repo: "https://github.com/acme/app.git", branch: "main" });
  // real previews, built by the real pipeline
  await s.call("sites.preview_rebuild", { siteId, branch: "feat/x", wait: true });
  await s.call("sites.preview_rebuild", { siteId, branch: "main", wait: true });
  s.store(siteId, STORED.name, STORED.handle);
  s.store(siteId, "P", "#Crm_Key.preview", "previews");
  assert.equal(
    await s.agent("sites.preview_promote", { siteId, branch: "main" }),
    "ok",
    "a preview of the production branch is the site's own",
  );
  const held = rig(s.opts);
  assert.equal(
    (await held.invoke("sites.preview_promote", { siteId, branch: "feat/x" }, asAgent())).status,
    "held",
    "a preview of another branch of the same repo is held",
  );
  assert.deepEqual(held.parked, [{ cap: "sites.preview_promote", act: "send" }]);
  await s.yes("sites.preview_promote", { siteId, branch: "feat/x" }, "apv_p1");
  assert.deepEqual(
    hostsOf(s),
    [await SRC("acme/app", "feat/x")],
    "the production key is approved for that branch; the previews-scope key is not part of it",
  );
  assert.equal(await s.agent("sites.preview_promote", { siteId, branch: "feat/x" }), "ok");
  assert.equal(await s.person("sites.preview_promote", { siteId, branch: "feat/x" }), "ok", "a person is one step");
  // the site moves to another repo (a real update); the old preview is built from somewhere else now
  await s.call("sites.update", { siteId, source: { repo: "https://github.com/other/app.git", branch: "main" } });
  assert.equal(await s.agent("sites.preview_promote", { siteId, branch: "main" }), "held", "a repo it moved away from");
  // a preview with no recorded origin (a build from before it was kept) is not known to be the site's own: it holds
  s.sw.sdb.run("UPDATE sites_deployment SET built_from = NULL WHERE site_id = ? AND env = 'preview'", siteId);
  await s.call("sites.update", { siteId, source: { repo: "https://github.com/acme/app.git", branch: "main" } });
  assert.equal(await s.agent("sites.preview_promote", { siteId, branch: "main" }), "held");
  assert.equal(
    wantsFromInput("sites.preview_promote", { siteId, branch: "main" }),
    "serve a preview as production with the site's keys",
  );
});

test("what reaches production on a real site that stores Vault keys is a person's to change: the webhook's branches, deploy on push, the settings; a site with no keys is free", async () => {
  const s = siteWorld();
  const siteId = await s.site("App", { repo: "https://github.com/acme/app.git", branch: "main" });
  s.store(siteId, STORED.name, STORED.handle);
  const held = (cap: string, input: Record<string, unknown>) => s.agent(cap, { siteId, ...input });
  assert.equal(await held("sites.webhook_set", { follow: ["*"] }), "held", "which branches the webhook builds");
  assert.equal(await held("sites.webhook_set", { enabled: true }), "held", "turning it on");
  assert.equal(await held("sites.update", { autoDeploy: true }), "held", "deploy on push");
  assert.equal(await held("sites.update", { settings: { defaultBranch: "x" } }), "held", "the settings record");
  assert.equal(await held("sites.webhook_set", { rotate: true }), "ok", "a new secret changes nothing that is built");
  assert.equal(await held("sites.webhook_set", { enabled: false }), "ok", "turning it off");
  assert.equal(await held("sites.update", { name: "New name" }), "ok", "a name");
  assert.equal(await s.person("sites.webhook_set", { siteId, follow: ["*"] }), "ok", "a person is one step");
  s.keysOff(siteId);
  assert.equal(await held("sites.webhook_set", { follow: ["*"] }), "ok", "no keys stored, nothing to protect");
  s.store(siteId, "P", "#Crm_Key.p", "previews");
  assert.equal(
    await held("sites.webhook_set", { follow: ["*"] }),
    "ok",
    "a previews-only key does not reach production",
  );
});

test("anything the Gate cannot read holds an agent: a site it cannot see, a preview with no recorded origin, a source it cannot name", async () => {
  const s = siteWorld();
  const siteId = await s.site("App", { repo: "https://github.com/acme/app.git" });
  s.store(siteId, STORED.name, STORED.handle);
  // a site that is not there
  const ghost = "sit_ghost";
  s.known.push(ghost);
  assert.equal(await s.agent("sites.deploy", { siteId: ghost, source: { repo: "acme/app" } }), "held");
  assert.equal(await s.agent("sites.preview_promote", { siteId: ghost, branch: "x" }), "held");
  assert.equal(await s.agent("sites.webhook_set", { siteId: ghost, follow: ["*"] }), "held");
  // a preview built before its origin was kept
  await s.call("sites.preview_rebuild", { siteId, branch: "x", wait: true });
  s.sw.sdb.run("UPDATE sites_deployment SET built_from = NULL WHERE site_id = ? AND env = 'preview'", siteId);
  assert.equal(await s.agent("sites.preview_promote", { siteId, branch: "x" }), "held");
  // a source that cannot be named, on a site whose own source is not there
  s.sw.sdb.run("UPDATE sites_site SET source = NULL WHERE id = ?", siteId);
  assert.equal(await s.agent("sites.deploy", { siteId, source: { repo: "https://u:p@git.example/a/b" } }), "held");
  // a person is one step through all of it
  assert.equal(await s.person("sites.preview_promote", { siteId, branch: "x" }), "ok");
});

test("uploaded files on a real site are other code when they are replaced, renamed or moved: the same files are free, others are held until that exact content is approved, and a person's own upload is one step", async () => {
  const s = siteWorld();
  const siteId = await s.site("Up", { folderId: "fld_up" }, false);
  await s.deployUpload(siteId);
  s.store(siteId, STORED.name, STORED.handle);
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok", "the same files: free");
  // an agent replaces a file in the folder (a new version) and redeploys: other code
  s.tree.files["fld_up"]![0]!.version = 2;
  assert.equal(await s.agent("sites.deploy", { siteId }), "held", "replaced files with a stored key");
  // naming the same folder again is no way around it: the files are not the deployed ones
  assert.equal(await s.agent("sites.deploy", { siteId, source: { folderId: "fld_up" } }), "held");
  await s.yes("sites.deploy", { siteId }, "apv_u1");
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok", "that exact content is approved");
  s.tree.files["fld_up"]![0]!.version = 3;
  assert.equal(await s.agent("sites.deploy", { siteId }), "held", "replaced again: held again");
  // the same content under another name, or in a subfolder, is other code too
  s.tree.files["fld_up"]![0]!.version = 2;
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok", "back to the approved content");
  s.tree.files["fld_up"]![0]!.name = "evil.html";
  assert.equal(await s.agent("sites.deploy", { siteId }), "held", "a renamed file");
  s.tree.files["fld_up"]![0]!.name = "index.html";
  s.tree.folders["fld_up"] = [{ folderId: "fld_sub", name: "sub" }];
  s.tree.files["fld_sub"] = [];
  assert.equal(await s.agent("sites.deploy", { siteId }), "held", "a new folder in the tree");
  delete s.tree.folders["fld_up"];
  // a person's own upload is one step, and its build records what it read, so the agent's next redeploy is free
  s.tree.files["fld_up"]![0]!.version = 4;
  assert.equal(await s.person("sites.deploy", { siteId }), "ok");
  await s.deployUpload(siteId);
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok", "the person's deploy is the baseline now");
  // an agent names another folder: another source
  s.tree.files["fld_other"] = [{ fileId: "fil_o", name: "x", version: 1, size: 1 }];
  assert.equal(await s.agent("sites.update", { siteId, source: { folderId: "fld_other" } }), "held");
  // a site with no keys stored has nothing to protect
  s.keysOff(siteId);
  s.tree.files["fld_up"]![0]!.version = 9;
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok");
});

test("a fingerprint the Gate cannot make holds an agent, never passes as unchanged: a Files read error, a folder over the cap, a site deployed before fingerprints were kept", async () => {
  const s = siteWorld();
  const siteId = await s.site("Up", { folderId: "fld_up" }, false);
  await s.deployUpload(siteId);
  s.store(siteId, STORED.name, STORED.handle);
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok", "the files are read and are the deployed ones");
  // Files cannot be read
  s.state.readable = false;
  assert.equal(await s.agent("sites.deploy", { siteId }), "held", "a Files read error");
  assert.equal(await s.agent("sites.deploy", { siteId, source: { folderId: "fld_up" } }), "held");
  s.state.readable = true;
  // a folder past what a fingerprint reads
  s.tree.files["fld_big"] = Array.from({ length: 20_001 }, (_, n) => ({
    fileId: `fil_${n}`,
    name: `f${n}`,
    version: 1,
    size: 1,
  }));
  assert.equal(await s.agent("sites.update", { siteId, source: { folderId: "fld_big" } }), "held", "over the cap");
  // pages: a file on the third page is read, so replacing it is seen
  s.tree.files["fld_up"] = Array.from({ length: 1200 }, (_, n) => ({
    fileId: `fil_${n}`,
    name: `f${n}`,
    version: 1,
    size: 1,
  }));
  await s.deployUpload(siteId);
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok");
  s.tree.files["fld_up"]![1100]!.version = 2;
  assert.equal(await s.agent("sites.deploy", { siteId }), "held", "a change on the last page");
  // a site deployed before fingerprints were kept: no baseline, so the first agent deploy is held once, and approved after a yes
  s.tree.files["fld_up"]![1100]!.version = 1;
  s.sw.sdb.run("UPDATE sites_deployment SET built_from = NULL WHERE site_id = ?", siteId);
  assert.equal(await s.agent("sites.deploy", { siteId }), "held", "no recorded baseline");
  await s.yes("sites.deploy", { siteId }, "apv_u2");
  assert.equal(await s.agent("sites.deploy", { siteId }), "ok", "held once");
  assert.equal(await s.person("sites.deploy", { siteId }), "ok");
});

test("a service a tenant can make (a form, a site, an Automation's own service) is held like an agent; the host's own services are not", async () => {
  const r = rig();
  const at = async (id: string, kind = "service"): Promise<unknown> =>
    await r.gate.applies(r.defOf("members.invites.create"), INPUT["members.invites.create"], {
      principal: { kind, id },
    } as never);
  for (const id of ["svc_form_x", "svc_site_x", `svc_${"a1".repeat(16)}`, "aut_1", "svc_legacy_thing", "svc_seed"])
    assert.deepEqual(await at(id), { act: "admit" }, `${id} is held`);
  for (const id of ["svc_host", "svc_engine", "svc_sync"]) assert.equal(await at(id), null, `${id} is one step`);
  assert.deepEqual(await at("act_1", "actor"), { act: "admit" });
  assert.equal(await at("usr_admin", "person"), null);
  // a changeset's approval: any agent is held with or without a push; a person only for a push
  const c = rig();
  const ask = async (kind: string, id: string, push: boolean): Promise<unknown> =>
    await c.gate.applies(c.defOf("changesets.approve"), { changesetId: "chg_1", ...(push ? { push: true } : {}) }, {
      principal: { kind, id },
    } as never);
  assert.deepEqual(await ask("agent", "agt_bot", false), { act: "push_protected" });
  assert.deepEqual(await ask("agent", "agt_bot", true), { act: "push_protected" });
  assert.equal(await ask("person", "usr_admin", false), null);
  assert.deepEqual(await ask("person", "usr_admin", true), { act: "push_protected" });
});

test("in a Personal Space the access checker answers needs_team: an agent's key use is held for a host nobody approved, not refused; any other failure of the check holds too", async () => {
  for (const code of ["permission.needs_team", "internal.unavailable"]) {
    const w = keyWorld();
    const r = rig({
      ...w.opts,
      call: async (cap: string) => {
        if (cap === "access.check")
          throw new HostError({ code, message: "x", retryable: false, traceId: "t".repeat(32) } as never);
        return null;
      },
    });
    assert.equal((await r.invoke("sync_specs.sample", SAMPLE("api.crm.example"), asAgent())).status, "held", code);
    assert.deepEqual(r.ran, []);
  }
});

test("a key in a shape the rule cannot read holds an agent (it fails closed), and a call with no key at all is not held", async () => {
  const w = keyWorld();
  const r = rig(w.opts);
  const weird = { creds: { k: "#Crm_Key" }, domain: "api.crm.example" };
  assert.deepEqual(await r.gate.applies(r.defOf("sync_specs.sample"), weird, { ...asAgent() } as never), {
    act: "send",
  });
  assert.equal(
    await r.gate.applies(r.defOf("sites.create"), { name: "s", source: { repo: "acme/app" } }, {
      ...asAgent(),
    } as never),
    null,
  );
});

test("handing a Vault key to someone is held for an agent on vault.share and on access.share of a Vault item or folder; a share of anything else, and a person's own, are not", async () => {
  const r = rig();
  const def = (n: string) => registry.capabilities.find((c) => c.name === n) as unknown as CapabilityDef;
  const share = (type: string) => ({
    resource: { type, id: "vit_crm" },
    subject: { kind: "agent", id: "agt_other" },
    level: "use",
    idempotencyKey: "vs-1",
  });
  const at = async (n: string, input: unknown, principal: { kind: string; id: string }) =>
    await r.gate.applies(def(n), input, { principal } as never);
  const agent = { kind: "agent", id: "agt_bot" };
  assert.deepEqual(await at("vault.share", share("vault_item"), agent), { act: "admit" });
  assert.deepEqual(await at("access.share", share("vault_folder"), agent), { act: "admit" });
  assert.equal(
    await at("access.share", share("record"), agent),
    null,
    "a share of a record stays under the caller's access",
  );
  assert.equal(await at("vault.share", share("vault_item"), { kind: "person", id: "usr_admin" }), null);
  assert.deepEqual(await at("vault.share", share("vault_item"), { kind: "service", id: "svc_form_x" }), {
    act: "admit",
  });
});

test("a marked refusal passes through the Gate whatever class the error is; an unmarked one, of any class, holds", async () => {
  const def = { name: "x.y", effects: "write", gate: { act: "send", when: "x.y(input)" } } as unknown as CapabilityDef;
  const gateWith = (thrown: unknown) =>
    createGateHook({
      call: async (cap: string) => (cap === "gate.effective_rule" ? { hold: true } : null),
      unseal: () => new Uint8Array(),
      now: () => 1,
      evaluators: {
        "x.y": () => {
          throw thrown;
        },
      },
    } as never);
  const seedOf = { principal: { kind: "agent", id: "agt_bot" } } as never;
  const marked = { error: { code: "permission.no_grant", message: "no", details: { refusal: true } } };
  await assert.rejects(
    async () => await gateWith(marked).applies(def, {}, seedOf),
    (e: unknown) => e === marked,
  );
  assert.deepEqual(await gateWith({ error: { code: "internal.unavailable", details: {} } }).applies(def, {}, seedOf), {
    act: "send",
  });
  assert.deepEqual(await gateWith(new Error("boom")).applies(def, {}, seedOf), { act: "send" });
});

test("an evaluator whose inner call fails with a refusal still holds: only a refusal the key rule marks is passed through", async () => {
  const read = registry.capabilities.find((c) => c.name === "automations.read_link") as unknown as CapabilityDef;
  const down = rig({
    call: async (cap: string) => {
      if (cap === "gate.links.known")
        throw new HostError({ code: "internal.unavailable", message: "down", retryable: true, traceId: "t" } as never);
      return null;
    },
  });
  assert.deepEqual(
    await down.gate.applies(read, { url: "https://example.com/a" }, { ...asAgent() } as never),
    { act: "send" },
    "an internal.unavailable from links.is_composed is a card, not an error",
  );
});

test("through the real Gate: an agent that may not itself use the Vault item is refused, not held, even when the person it works for may", async () => {
  const w = keyWorld("deny");
  const r = rig(w.opts);
  const refused = await r.invoke("sync_specs.sample", SAMPLE("api.crm.example"), asAgent()).catch((e: unknown) => e);
  assert.ok(refused instanceof HostError, "a clean refusal, not a 500 and not a hold");
  assert.equal(refused.error.code, "permission.no_grant");
  assert.notEqual(refused.error.traceId, "0".repeat(32), "the refusal carries the call's own trace id");
  assert.ok(refused.error.traceId.length === 32);
  assert.deepEqual([r.parked, r.ran], [[], []], "nothing was parked and nothing ran");
});

test("through the real Gate: an Automation's step is held on a pause, resume or sync-state switch, an agent is held, a person and the sync's own service are not", async () => {
  const r = rig();
  const input = { mailboxId: "mbx_a" };
  for (const name of ["mail.mailbox.pause", "mail.mailbox.resume", "mail.mailbox.set_sync_state"]) {
    const d = r.defOf(name);
    const at = (principal: { kind: string; id: string }, extra: object = {}) =>
      r.gate.applies(d, input, { space: "spc_1", principal, ...extra } as never);
    assert.deepEqual(await at({ kind: "agent", id: "agt_bot" }), { act: "send" }, `${name}: an agent is held`);
    assert.deepEqual(
      await at({ kind: "person", id: "usr_admin" }, { step: { automationId: "aut_9" } }),
      { act: "send" },
      `${name}: an Automation's step is held`,
    );
    assert.equal(await at({ kind: "person", id: "usr_admin" }), null, `${name}: a person is one step`);
    assert.equal(await at({ kind: "service", id: "svc_host" }), null, `${name}: the host's own service is one step`);
  }
});
