// The mail module is not the only place mail can be rerouted or a sender changed: the provider capabilities behind it, the setting that picks the provider, and a person's default sender are reachable too.
// Every such write is held at the Gate for an agent, or is on a short list with the reason it is not. A new one in any module cannot slip in without one or the other.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";

type Def = { name: string; module: string; effects: string; gate?: { act: string; when?: string; reason?: string } };
const all = registry.capabilities as unknown as Def[];
const def = (name: string): Def => all.find((c) => c.name === name) as Def;
const held = (g: Def["gate"]): boolean =>
  !!g &&
  ((g.when ?? "").length > 0
    ? /actor\.kind != 'person'|^mail\.is_provider_setting\(/.test(g.when ?? "")
    : g.act !== "none");

/** Writes outside the mail module whose name says routes, senders, forwarding, aliases, SMTP or inbound mail, and are not held: each with why. */
const NOT_HELD: Record<string, string> = {
  "mailgun.domains.verify": "asks Mailgun to re-check DNS; nothing is changed or sent",
  "resend.domains.verify": "asks Resend to re-check DNS; nothing is changed or sent",
  "mailgun.receive_inbound": "a signed delivery from Mailgun, not a person's or agent's choice",
  "mailgun.receive_webhook": "a signed delivery event from Mailgun",
  "resend.receive_inbound": "a signed delivery from Resend",
  "resend.receive_webhook": "a signed delivery event from Resend",
  "telephony.number.set_route": "where a phone number's calls and texts go, not email (comms.numbers)",
  "access.automation_senders":
    "a person's own press gives an Automation use of the mailboxes it names, inside that person's access",
};

test("every provider-level write that adds a sending domain or an inbound route, and the setting that picks the provider, is held for an agent", () => {
  for (const name of [
    "mailgun.domains.create",
    "mailgun.routes.create",
    "resend.domains.create",
    "comms.senders.set_default",
  ]) {
    const g = def(name).gate;
    assert.equal(g?.act, "send", `${name} is held as an outward act`);
    assert.equal(g?.when, "actor.kind != 'person'", `${name} holds only for an agent or automation`);
  }
  for (const name of ["mailgun.domains.delete", "mailgun.routes.delete", "resend.domains.delete"])
    assert.ok(held(def(name).gate), `${name} is held`);
  for (const name of ["settings.set_space", "settings.reset_space"]) {
    const g = def(name).gate;
    assert.deepEqual(
      [g?.act, g?.when],
      ["send", "mail.is_provider_setting(input.key)"],
      `${name} holds a change to mail.provider`,
    );
  }
});

test("a write in any module whose name says routes, senders, forwarding, aliases, SMTP or inbound mail is held, or named here with the reason", () => {
  const sweep = all.filter(
    (c) => c.module !== "mail" && c.effects !== "read" && /(route|sender|forward|alias|smtp|inbound)/i.test(c.name),
  );
  const loose = sweep.filter((c) => !held(c.gate) && !(c.name in NOT_HELD)).map((c) => c.name);
  assert.deepEqual(
    loose,
    [],
    "these change where mail goes or who it is sent as with no hold and no stated reason: hold each (gate act send when the actor is not a person) or add it to NOT_HELD with why",
  );
  for (const name of Object.keys(NOT_HELD)) assert.ok(def(name), `${name} on the list is a real capability`);
  // and the provider modules in full: every write there is held, on the list, or a send that is already held
  const provider = all.filter((c) => ["mailgun", "resend"].includes(c.module) && c.effects !== "read");
  assert.deepEqual(
    provider.filter((c) => !held(c.gate) && !(c.name in NOT_HELD)).map((c) => c.name),
    [],
  );
});
