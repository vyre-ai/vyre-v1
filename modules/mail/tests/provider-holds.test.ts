// The mail module is not the only place mail can be rerouted or a sender changed: the provider capabilities behind it, the setting that picks the provider, and a person's default sender are reachable too.
// Every such write is held at the Gate for an agent, or is on a short list with the reason it is not. A new one in any module cannot slip in without one or the other.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { held } from "../fixtures/hold-rules.ts";

type Def = { name: string; module: string; effects: string; gate?: { act: string; when?: string; reason?: string } };
const all = registry.capabilities as unknown as Def[];
const def = (name: string): Def => all.find((c) => c.name === name) as Def;

/**
 * Anything that decides where communications go (email, calls, texts, voicemail and their transcripts) or who gets a copy: a name that says routes, senders, forwarding, aliases, SMTP, inbound mail, relays, bcc or cc, recipients, webhooks, notifications, digests or sharing,
 * and every write in the phone modules. Each is held for an agent or matches one of these, with why. "Not email" is not a reason.
 */
const NOT_HELD: [RegExp, string][] = [
  [
    /\.receive_(inbound|webhook|notification)$/,
    "a signed delivery from the provider, not a person's or an agent's choice",
  ],
  [/^(mailgun|resend)\.domains\.verify$/, "asks the provider to re-check DNS; nothing is changed or sent"],
  [
    /^notifications\.(send|push\.register|push\.unregister|mark_seen|mute\.set|mute\.clear|away\.set|away\.clear|kind\.set_level|rules\.set)$/,
    "a person's own notification settings or a push that carries no content; it adds no recipient and sends nothing to anyone new (notifications.delegate.set, which hands approvals to someone, is held)",
  ],
  [
    /^(home\.(away_digest|mark_digest_seen|write_digest)|machines\.alerts_notify)$/,
    "writes the person's own digest or alert line in the Space (alerts_notify is host only); no new destination",
  ],
  [
    /^(access\.(share|unshare|join_share|audience_set)|chat\.share|notes\.share|files\.share|vault\.(share|unshare)|skills\.(share|shared\.decide)|automations\.connector_share|meetings\.closeout\.share)$/,
    "a grant inside the Space: an agent acts for a person and is never wider than that person (kernel/tests/authorize.agent.test.ts, the property over 200 worlds), it needs Manage on the thing (modules/access/handlers/share.ts:904), audience_set needs Manage (share.ts:1699), vault.share needs manage (modules/vault/handlers/items.ts:910) and then calls access.share, skills.share only offers a card the recipient accepts (manifests/_agents-skills.ts:279), a guest or an agent for a guest never shares with Everyone (share.ts:1001), and in a thread an outside-started Run marked, these are held for a yes (lib/automation-content.ts:42). Sharing outside the Space is held separately",
  ],
  [
    /^(threads|channels)\.members\.add$/,
    "the product's own flows add people to a chat as the agent or the Automation step that makes it (a goal's helpers, a task's assignee: test/goals.helpers.live.test.ts, test/automations.rc28.live.test.ts), and what the newcomer reads is set by the adder's own floor (modules/chat/tests/chat-acts.live.test.ts); an agent that adds someone to a chat the person can see is the person's own chat work",
  ],
  [/^projects\.unshare_out$/, "takes outside access away"],
  [
    /^(access\.(groups\.remove_member|roles\.(delete|unassign))|channels\.members\.remove|projects\.members\.remove|threads\.members\.remove|members\.join_requests\.decline|gate\.grants\.(take|give_back|ask))$/,
    "takes access away, declines a request, or is the caller's own ask or return of a standing yes (a person's yes is still needed to give one: gate.grants.set and goal are held)",
  ],
  [
    /^(channels\.(join|home_join)|identity\.sso_join_start|members\.accept)$/,
    "the caller's own join of a place they can already see, or an anonymous or pending person's own step with an invitation code",
  ],
  [
    /^(agents\.role_line\.set|chat\.remember|memory\.remember)$/,
    "writes a line of words or a memory note under the caller's own access; it gives nobody access and sends nothing (the name only says role or member)",
  ],
  [
    /^(members\.(invites\.(revoke|guest)|join_link\.(disable|request))|forms\.(unpublish|link_revoke)|vault\.exports\.revoke|projects\.links\.unlink|tasks\.links\.remove|projects\.unlink_tasks)$/,
    "takes an invitation, link or outside access away, or is called only by a held capability (members.invites.guest only by threads.invite_guest, held); join_link.request is the joiner's own press with the code",
  ],
  [
    /^(sites\.(publish|artifact_publish|signin_link)|views\.publish|kits\.publish|connectors\.publish)$/,
    "serves or shares only inside the Space to people who already have access (a view, a Kit, a connector an agent built for the Space, a Space or private site, a page); putting a site on the public internet, sites.promote, is held; signin_link signs in only the person asking",
  ],
  [
    /^(automations\.packages\.export|memory\.graph_export)$/,
    "saves a file or package inside the Space under the caller's own access; no secret, Vault value or run data in the package, and personal layers are never in a graph",
  ],
  [
    /^(calendar\.link_record|inbox\.link_message|portal\.link_record|projects\.link_tasks|projects\.links\.(link|rules\.set)|tasks\.links\.add|sources\.link\.resolve)$/,
    "ties two things already in the Space together; it sends nothing and shows nothing to anyone new",
  ],
  [
    /^(gate\.holds\.revise|governance\.holds\.(place|release)|records\.(hold|release_hold))$/,
    "a legal or approval hold: it keeps data in place, it routes nothing",
  ],
  [
    /^identity\.(link_account|sso_link)$|^invites\.accept_create_account$|^install\.from_link$/,
    "a sign-in step with no agent tool (identity.github_link and github_unlink, which change a sign-in method, are held), an anonymous join by invite code, or a plan from an address the person pasted that installs nothing (install.from_link)",
  ],
  [
    /^automations\.webhook_url\.rotate$/,
    "makes a new address for the Space's own incoming webhook; it sends nothing anywhere",
  ],
  [
    /^access\.(automation_senders|agents_can_call\.set)$/,
    "a person's own press inside that person's access (access.automation_senders: an Automation's use of the mailboxes it names)",
  ],
  [
    /^telephony\.(call\.(attach_summary|log_task|erase)|ingest_recording|ingest_sms|sms\.erase)$/,
    "records or erases what already happened on a call or text; it routes nothing (erase is under policy.manage)",
  ],
  [
    /^twilio\.(call\.update|recording\.(start|stop|delete))$/,
    "acts on a call already in progress, which a person is on; it adds no destination",
  ],
  [
    /^telephony\.(answer|decline|hangup|hold|record)$/,
    "acts on a live call the person is on; it adds no destination (telephony.transfer, which sends a call to another number, is held)",
  ],
  [/^telephony\.ingest_(status|voice)$/, "the provider's call events, not a person's or an agent's choice"],
  [
    /^telephony\.registration\.(refresh|save|submit)$|^twilio\.(a2p\.create_brand|a2p\.create_campaign|twiml_app\.ensure)$/,
    "registers the Space's own business with the carriers and its own voice app; it sends nothing to a new destination",
  ],
  [
    /^webhooks\.(delete|rotate_secret|test|send_delivery|replay_delivery)$/,
    "acts on an endpoint a person already registered (delete removes one, test and replay go only to it); creating or changing the address, webhooks.create and update, is held",
  ],
  [
    /^stripe\.payment_link\.create$/,
    "makes a payment page; nobody is contacted and no money moves until a customer pays (its own quiet Gate reason)",
  ],
  [/^twilio\.number\.(buy|release)$/, "buying or releasing a number is held by its pay or delete Gate"],
];
const notHeldWhy = (name: string): string | undefined => NOT_HELD.find(([re]) => re.test(name))?.[1];
const SWEEP =
  /(route|sender|forward|alias|smtp|inbound|relay|bcc|\bcc\b|recipient|webhook|notif|digest|share|invite|guest|export|publish|link|hold|join|approve|reactivate|suspend|member|grant|role)/i;

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

test("a write anywhere that routes, copies or forwards communications (email, calls, texts, voicemail, transcripts), changes a sender or adds a recipient is held for an agent, or matches a stated reason", () => {
  const writes = all.filter(
    (c) =>
      c.module !== "mail" &&
      c.effects !== "read" &&
      (SWEEP.test(c.name) || ["telephony", "twilio", "mailgun", "resend"].includes(c.module)),
  );
  const loose = writes.filter((c) => !held(c.gate) && notHeldWhy(c.name) === undefined).map((c) => c.name);
  assert.deepEqual(
    loose,
    [],
    "these change where communications go or who gets them with no hold and no stated reason: hold each (gate act send when the actor is not a person) or add the reason",
  );
  // the phone routes, hours, recording, assignment and webhook addresses are held
  for (const name of [
    "telephony.number.set_route",
    "telephony.number.set_hours",
    "telephony.number.set_recording",
    "telephony.number.assign",
    "telephony.number.import",
    "twilio.number.configure",
    "twilio.a2p.attach_number",
    "telephony.transfer",
    "webhooks.create",
    "webhooks.update",
    "notifications.delegate.set",
    "network.relay_set",
  ])
    assert.ok(held(def(name).gate), `${name} is held for an agent`);
  // every reason names something that exists, so a stale line is noticed
  for (const [re] of NOT_HELD)
    assert.ok(
      all.some((c) => re.test(c.name)),
      `the reason ${re} matches a real capability`,
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
const PLACE = /(host|url|endpoint|server|origin|baseurl|uri|webhook|callback|domain|repo|path)/i;

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

/** Held unless the host is approved for that Vault item (the same rule and store as a test read): a handle plus an address a caller names. */
const KEY_HOST_HELD = [
  "sites.create",
  "sites.deploy",
  "sites.plan",
  "sites.update",
  "sync_specs.apply",
  "sync_specs.preview",
  "sync_specs.sample",
  "sync_specs.survey",
  "sync_specs.validate",
];

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
    .filter((x) => !held(x.gate) && !(x.name in HANDLE_OK))
    .map((x) => `${x.name} ${JSON.stringify(x.handles)} with ${JSON.stringify(x.places)}`);
  assert.deepEqual(loose, [], "these send a Vault secret to a place the caller names with no hold and no reason");
  for (const name of Object.keys(HANDLE_OK)) assert.ok(def(name), `${name} on the list is a real capability`);
  for (const name of KEY_HOST_HELD)
    assert.equal(
      def(name).gate?.when,
      "vault.key_host_unapproved(input)",
      `${name} is held unless the host is approved for the key`,
    );
});
