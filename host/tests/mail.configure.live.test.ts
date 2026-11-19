// The email setup capabilities through the real invoke pipeline: the real definitions from the registry, the real kernel authorize over a real access snapshot, and the real Gate hook.
// mail.configure routes to these, so they are its whole door: a member without comms.domains is refused, an admin is let in, and when an agent changes the Space's mail server or moves an address the call is held for a person's ok.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createIdempotency } from "../../kernel/src/idempotency/index.ts";
import { registry } from "../../generated/registry.ts";
import { createGateHook, moduleWhens } from "../src/daemon/gate-hook.ts";
import { createInvoke, createRateLimiter, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, Handler, InvokeDeps } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import { CONFIGURE_ROUTE } from "../../modules/mail/handlers/setup.ts";
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
const defs = [...CALLEES, ...REROUTES, ...PROVIDER].map(
  (n) => registry.capabilities.find((c) => c.name === n) as unknown as CapabilityDef,
);

function world(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "dom_1", type: "domain", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putRole({ id: "member", clearance: 2, perms: [], name: "Member" });
  s.putRole({ id: "admin", clearance: 3, perms: ["comms.domains", "policy.manage"], name: "Admin" });
  s.putRole({ id: "mailer", clearance: 2, perms: ["comms.domains", "policy.manage"], name: "Mailer" }); // an agent never holds Admin or Owner, so the one it has is a plain role that carries the permission
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
  return s;
}

function rig() {
  const snap = world();
  const ran: string[] = [];
  const parked: { cap: string; act: string }[] = [];
  const handlers: Record<string, Handler> = Object.fromEntries(
    [...CALLEES, ...REROUTES, ...PROVIDER].map((n) => [n, (async () => (ran.push(n), {})) as Handler]),
  );
  const store = new Map<string, { hash: string; result: unknown }>();
  const gate = createGateHook({
    call: async (cap) => (cap === "gate.effective_rule" ? { hold: true } : null),
    unseal: () => new Uint8Array(),
    now: () => 0,
    hold: () => null,
    evaluators: moduleWhens(
      new Map(),
      () => null,
      async () => null,
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
  return { invoke: createInvoke(deps), ran, parked };
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
