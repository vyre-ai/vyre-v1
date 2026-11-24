// mail.configure carries no permission of its own: every action routes to the capability behind the screen, so those capabilities are the whole door. This pins them against the registry and the real kernel,
// and sweeps every mail capability that writes: one that changes where mail goes or who it is sent as is held at the Gate when the actor is not a person, and a new one cannot slip in without either that hold or a stated reason.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../../kernel/src/authorize/index.ts";
import { registry } from "../../../generated/registry.ts";
import { CONFIGURE_ROUTE, OWN_PERMISSION_ROUTES } from "../handlers/setup.ts";
import fs from "node:fs";
import { held } from "../fixtures/hold-rules.ts";

type Def = {
  name: string;
  module: string;
  effects: string;
  permission: string | null;
  level: string;
  gate?: { act: string; when?: string; reason?: string };
};
const all = registry.capabilities as unknown as Def[];
const def = (name: string): Def => all.find((c) => c.name === name) as Def;
// the callees come from mail.configure's own routing table, so a new action is checked the day it is added
const CALLEES = Object.entries(CONFIGURE_ROUTE)
  .filter(([action]) => !(OWN_PERMISSION_ROUTES as readonly string[]).includes(action))
  .map(([, cap]) => cap);

test("every capability mail.configure routes to demands comms.domains, and a member without it is refused by the kernel", () => {
  const s = new AccessSnapshot();
  s.putResource({ id: "spc_t", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putRole({ id: "member", clearance: 1, perms: [], name: "member" });
  s.putRole({ id: "admin", clearance: 3, perms: ["comms.domains"], name: "admin" });
  for (const [id, role, level] of [
    ["usr_member", "member", "edit"],
    ["usr_admin", "admin", "manage"],
  ] as const) {
    s.putPrincipal({ id, kind: "person", status: "active", name: id });
    s.addPrincipalRole({ holder: id, role });
    s.putGrant({
      id: `gr_${id}`,
      subject_kind: "role",
      subject_id: role,
      resource_type: "space",
      resource_id: "spc_t",
      level,
      source: `role:${role}`,
    });
  }
  assert.ok(CALLEES.length >= 8);
  for (const name of CALLEES) {
    const c = def(name);
    assert.ok(c, `${name} is in the registry`);
    assert.equal(c.permission, "comms.domains", `${name} asks for comms.domains`);
    const ask = (who: string) =>
      authorize(s, {
        principal: who,
        action: { perm: c.permission, level: c.level as "view" },
        resource: { type: "space", id: "spc_t" },
        now: 1_760_000_000_000,
      });
    assert.equal(ask("usr_member").effect, "deny", `${name}: a member without comms.domains is refused`);
    assert.equal(ask("usr_admin").effect, "allow", `${name}: an admin with it is let in`);
  }
  assert.equal(
    def("mail.configure").permission,
    null,
    "the tool has no permission of its own; the capabilities behind it are the door",
  );
});

/** Mail capabilities that write and are not held for an agent, each with why. Anything else that writes must carry the hold. */
const NOT_HELD: Record<string, string> = {
  "mail.attachment.save": "copies an attachment into Files for a person who can already read the message",
  "mail.auto_connect_members":
    "the Google and Microsoft syncs call it for members the directory lists; a person turned that sync on",
  "mail.configure": "routes to the capabilities behind it, each with its own permission and hold",
  "mail.domain.check": "reads DNS and the provider and records the answer; it changes nothing about where mail goes",
  "mail.draft": "makes a draft; nothing leaves until mail.send, which is held",
  "mail.drafts.discard": "throws away one's own draft",
  "mail.ingest": "the provider's inbound mail, not a person's or agent's choice",
  "mail.member_pause": "the connector pauses a member's mailbox when the member leaves or the company turns Mail off",
  "mail.message.erase": "erases one message under policy.manage",
  "mail.message.set_private": "hides one message from others; it does not move mail",
  "mail.status_update": "the provider's delivery events",
  "mail.sync_now": "pulls mail now from a mailbox that is already connected",
  "mail.unsubscribe": "a recipient's own unsubscribe link",
};
test("every mail capability that writes is held at the Gate for an agent, or is on the short list of ones that do not move mail or change who it is sent as, with the reason", () => {
  const writes = all.filter((c) => c.module === "mail" && c.effects !== "read");
  const unheld = writes.filter((c) => !held(c.gate) && !(c.name in NOT_HELD)).map((c) => c.name);
  assert.deepEqual(
    unheld,
    [],
    "these write mail configuration with no hold and no stated reason: hold each (gate act send when the actor is not a person) or add it to NOT_HELD with why",
  );
  for (const name of Object.keys(NOT_HELD)) assert.ok(def(name), `${name} on the list is a real capability`);
  // the ones that move mail or change who it is sent as are held
  for (const name of [
    "mail.smtp.set",
    "mail.address.add",
    "mail.address.move",
    "mail.domain.add",
    "mail.domain.remove",
    "mail.domain.set_default",
    "mail.route.set",
    "mail.route.remove",
    "mail.mailbox.create",
    "mail.mailbox.update",
    "mail.mailbox.set_privacy",
    "mail.mailbox.disconnect",
    "mail.mailbox.pause",
    "mail.mailbox.resume",
    "mail.mailbox.set_sync_state",
    "mail.connect",
    "mail.smtp.verify",
    "mail.template.save",
    "mail.template.reset",
    "mail.template.for_document.set",
    "mail.template.for_document.clear",
  ])
    assert.ok(held(def(name).gate), `${name} is held for an agent`);
});

test("the host live test names exactly the capabilities mail.configure routes to (it imports no module, so this keeps the two the same)", () => {
  const text = fs.readFileSync(new URL("../../../test/gate.holds.real-rule.test.ts", import.meta.url), "utf8");
  const block = /const CALLEES = \[([^\]]*)\]/.exec(text)?.[1] ?? "";
  const named = [...block.matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(named, CALLEES.filter((n) => n !== "mail.setup.test_send").sort());
});

test("the template and inbox-health actions of mail.configure keep the permission of the capability behind them: reads are open to members, changing wording asks for comms.templates and is held for an agent", () => {
  const routes = Object.fromEntries(
    Object.entries(CONFIGURE_ROUTE).filter(([a]) => (OWN_PERMISSION_ROUTES as readonly string[]).includes(a)),
  );
  for (const [action, cap] of Object.entries(routes)) {
    const c = def(cap);
    assert.ok(c, `${action} routes to ${cap}, which is in the registry`);
    const writes = ["template_save", "template_reset", "doc_template_set", "doc_template_clear"].includes(action);
    if (writes) {
      assert.equal(c.permission, "comms.templates", `${cap} asks for comms.templates`);
      assert.ok(held(c.gate), `${cap} is held for an agent`);
    } else {
      assert.notEqual(c.permission, "comms.domains", `${cap} is not an admin-only door: a member reads it`);
      assert.equal(c.effects, "read", `${cap} only reads`);
    }
  }
});
