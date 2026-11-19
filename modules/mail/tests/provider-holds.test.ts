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
    ? /actor\.kind != 'person'|actor\.kind == 'agent'|^mail\.[a-z_]+\(input(\.key)?\)$/.test(g.when ?? "")
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

// ---- a Vault handle (a secret reference) together with a place to send it: every such capability is held for an agent or is on this list with why the secret cannot go anywhere a caller chooses

type Schema = {
  $ref?: string;
  properties?: Record<string, Schema>;
  pattern?: string;
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  items?: Schema;
};
const defs = (registry as unknown as { $defs?: Record<string, Schema> }).$defs ?? {};
const resolve = (s: Schema | undefined, depth = 0): Schema | undefined =>
  s?.$ref && depth < 6 ? resolve(defs[s.$ref.split("/").pop() as string], depth + 1) : s;
/** Every property path of an input schema, nested objects included (an `imap: { host, passwordHandle }` counts), with whether it is a handle. */
function paths(s: Schema | undefined, prefix = "", depth = 0): { path: string; handle: boolean }[] {
  const r = resolve(s);
  if (!r || depth > 4) return [];
  const out: { path: string; handle: boolean }[] = [];
  for (const [k, v] of Object.entries(r.properties ?? {})) {
    const rv = resolve(v);
    out.push({ path: `${prefix}${k}`, handle: typeof rv?.pattern === "string" && rv.pattern.startsWith("^#") });
    out.push(...paths(rv, `${prefix}${k}.`, depth + 1));
  }
  for (const part of [...(r.allOf ?? []), ...(r.anyOf ?? []), ...(r.oneOf ?? [])])
    out.push(...paths(part, prefix, depth + 1));
  return out;
}
const PLACE = /(host|url|endpoint|server|origin|baseurl|uri|webhook|callback)/i;

/** Capabilities that take a handle and a place and are fine, each with why. */
const HANDLE_OK: Record<string, string> = {
  "automations.http_read":
    "not an agent capability (agent: false), and a Vault key goes only to a host a person approved for that key (modules/automations/key-hosts.ts)",
  "automations.http_send":
    "not an agent capability (agent: false), held by the Gate like any send, and a key goes only to an approved host",
  "import.parse_airtable": "the address only names the base; the request always goes to api.airtable.com",
  "import.parse_notion": "the address only names the page; the request always goes to api.notion.com",
  "mail.configure":
    "routes to mail.smtp.verify, mail.smtp.set and mail.connect, each held for an agent that names a server",
};

/** Found by the same sweep, checked, and NOT fixed here: they live in other lanes and changing who may call them changes those lanes' flows. Reported to the lead on 19 Nov. The test fails the day one is held, so the line is removed with the fix. */
const OPEN: Record<string, string> = {
  "sites.create": "a Vault token goes to the git host of the repo address the caller types (any https host)",
  "sync_specs.apply": "a spec's Vault handle is used with the app address the spec names",
  "sync_specs.preview": "a spec's Vault handle is used with the app address the spec names",
  "sync_specs.sample": "a Vault handle is sent to the url the caller types",
  "sync_specs.validate": "a spec's Vault handle is used with the app address the spec names",
};

test("every capability that takes a Vault handle together with a host or address (nested objects included) is held for an agent, or is named with why the secret cannot be sent where a caller chooses", () => {
  const found = all
    .map((c) => {
      const p = paths((c as unknown as { input?: Schema }).input);
      return {
        name: c.name,
        handles: p.filter((x) => x.handle).map((x) => x.path),
        places: p.filter((x) => PLACE.test(x.path)).map((x) => x.path),
        gate: c.gate,
      };
    })
    .filter((x) => x.handles.length && x.places.length);
  const names = found.map((x) => x.name);
  for (const must of ["mail.smtp.set", "mail.smtp.verify", "mail.connect", "import.parse_airtable"])
    assert.ok(names.includes(must), `${must} is seen by the sweep (a handle and a place)`);
  const loose = found
    .filter((x) => !held(x.gate) && !(x.name in HANDLE_OK) && !(x.name in OPEN))
    .map((x) => `${x.name} ${JSON.stringify(x.handles)} with ${JSON.stringify(x.places)}`);
  assert.deepEqual(loose, [], "these send a Vault secret to a place the caller names with no hold and no reason");
  for (const name of Object.keys(HANDLE_OK)) assert.ok(def(name), `${name} on the list is a real capability`);
  for (const name of Object.keys(OPEN)) assert.ok(!held(def(name)?.gate), `${name} is now held: remove it from OPEN`);
});
