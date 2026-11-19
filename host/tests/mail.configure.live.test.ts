// The email setup capabilities through the real invoke pipeline: the real definitions from the registry, the real kernel authorize over a real access snapshot, and the real Gate hook.
// mail.configure routes to these, so they are its whole door: a member without comms.domains is refused, an admin is let in, and when an agent changes the Space's mail server or moves an address the call is held for a person's ok.
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
];
// a Vault key sent to a host the call names
const KEYED = ["sync_specs.sample", "sync_specs.survey", "sync_specs.validate", "sites.create"];
const defs = [...CALLEES, ...REROUTES, ...PROVIDER, ...MORE, ...COMMS, ...KEYED].map(
  (n) => registry.capabilities.find((c) => c.name === n) as unknown as CapabilityDef,
);

function world(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "dom_1", type: "domain", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "num_1", type: "number", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "mbx_a", type: "mailbox", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putRole({ id: "member", clearance: 2, perms: [], name: "Member" });
  s.putRole({
    id: "admin",
    clearance: 3,
    perms: ["comms.domains", "policy.manage", "comms.templates", "comms.numbers", "connectors.manage"],
    name: "Admin",
  });
  s.putRole({
    id: "mailer",
    clearance: 2,
    perms: ["comms.domains", "policy.manage", "comms.templates", "comms.numbers", "connectors.manage"],
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
  const snap = world();
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
    authorize: (req) => authorize(snap, req),
    handler: (c) => handlers[c],
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    audit: () => {},
    publish: () => {},
    idem: (() => {
      const i = createIdempotency({
        get: (k) => store.get(k) ?? null,
        put: (k, _p, _c, rec) => void store.set(k, rec as { hash: string; result: unknown }),
      });
      return { once: (p, c, k, inp, run) => i.once(p, c, k, inp, run) };
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
const seed = (id: string, kind: "person" | "agent" = "person", extra: Partial<CtxSeed> = {}): CtxSeed =>
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
    const held = await asAgent.invoke(name, { ...INPUT[name] }, seed("agt_bot", "agent", { actingFor: "usr_admin" }));
    assert.equal(held.status, "held", `${name}: an agent is held`);
    assert.deepEqual(asAgent.parked, [{ cap: name, act: "send" }]);
    assert.deepEqual(asAgent.ran, [], `${name}: nothing ran before a person said yes`);
    const asPerson = rig();
    assert.equal(
      (await asPerson.invoke(name, { ...INPUT[name] }, seed("usr_admin"))).status,
      "ok",
      `${name}: a person's own change is one step`,
    );
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
    const held = await asAgent.invoke(name, { ...INPUT[name] }, seed("agt_bot", "agent", { actingFor: "usr_admin" }));
    assert.equal(held.status, "held", `${name}: an agent is held`);
    assert.deepEqual(asAgent.parked, [{ cap: name, act: "send" }]);
    assert.deepEqual(asAgent.ran, [], `${name}: nothing ran before a person said yes`);
    const asPerson = rig();
    assert.equal(
      (await asPerson.invoke(name, { ...INPUT[name] }, seed("usr_admin"))).status,
      "ok",
      `${name}: a person's own change is one step`,
    );
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
    const held = await asAgent.invoke(name, { ...INPUT[name] }, seed("agt_bot", "agent", { actingFor: "usr_admin" }));
    assert.equal(held.status, "held", `${name}: an agent is held`);
    assert.deepEqual(asAgent.parked, [{ cap: name, act: "send" }]);
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
      { space: "spc_1", ...asAgent() } as never,
    ),
    { act: "send" },
    "a site's git repo on a new host is held for an agent",
  );
  assert.equal(
    await site.gate.applies(
      site.defOf("sites.create"),
      { name: "s", source: { repo: "https://git.elsewhere.example/a/b", tokenHandle: "#Crm_Key" } },
      { space: "spc_1", ...seed("usr_admin") } as never,
    ),
    null,
    "and a person is one step",
  );
  // a call that names no key is not touched by the rule
  assert.equal(keySendOf({ name: "s" }), undefined);
  assert.equal(keySendOf({ name: "s", source: { repo: "acme/app", tokenHandle: "#T" } })?.host, "github.com");
});

test("through the real Gate: an agent that may not itself use the Vault item is refused, not held, even when the person it works for may", async () => {
  const w = keyWorld("deny");
  const r = rig(w.opts);
  assert.equal(
    await codeOf(r.invoke("sync_specs.sample", SAMPLE("api.crm.example"), asAgent())),
    "permission.no_grant",
  );
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
    assert.equal(
      await at({ kind: "service", id: "svc_google_sync" }),
      null,
      `${name}: the Google sync's own service is one step`,
    );
  }
});
