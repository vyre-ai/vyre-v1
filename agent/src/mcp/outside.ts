// What an outside agent may call. There is no scope list: it can use what the person who allowed it can, and the invoke pipeline makes that true on every call (agent and person must both allow, ARCH 4.5 rule 5). This file
// narrows only what the MCP door must never offer the agent itself, and it never widens anything.
//   Off here   the terminal, Vyre computers and every tool that runs on a machine of ours (it has its own machine), and the Vault toolset (a value never leaves, and a handle is no use outside a Vyre turn).
//   A person's own   signing in, devices, members, access, the rules of the Gate, the company's connections and the engineer tools stay with people. An agent cannot allow another client, cannot widen what it was given,
//              and cannot change who gets in. It can ask: the call waits for the person it acts for, runs as them on their yes, and is refused when they cannot do it either (docs/ask-the-person.md).
//   Paste      putting a key in the Vault, or asking for one, is a key request for the name only: the person pastes the value in their own app, and the agent gets the name, never the value or Use on it.
import type { ToolDef } from "../tools/types.ts";

const OFF_TOOLSETS: ReadonlySet<string> = new Set(["vault", "terminal", "computer"]);

/** Families of capability only a person changes. Reading them stays open when the person may read them. */
const PERSON_ONLY: ReadonlySet<string> = new Set(["mcp", "identity", "members", "devices", "access", "gate", "connections", "connectors", "dropbox", "network", "spaces", "updates", "backup", "governance", "billing"]);
/** The company's own connections, inside a family that is otherwise work: a person's tools for the mail in it stay. */
const PERSON_ONLY_CAPS = /^(google|ms|microsoft)\.(dwd|tenant|connect|directory)(\.|_|$)|^settings\.(set_space|floor_set|reset_space|copy_profile|kit\.set_space)$|^agents\.(delete|pause|resume|update|role_line\.set|config\.)/;
/** Asking is never a way past a person: this opens a question they answer. */
const ASKS: ReadonlySet<string> = new Set(["access.request"]);
/** Finding tools is not a power. */
const ALWAYS: ReadonlySet<string> = new Set(["mcp.tool.search", "mcp.tool.describe", "mcp.toolsets.list", "mcp.tools.list"]);

/** A tool that needs a person to press something, whoever else may use it. */
export function isPersonOnly(cap: string, effects: string): boolean {
  if (ASKS.has(cap) || effects === "read") return false;
  const family = cap.split(".")[0] as string;
  return PERSON_ONLY.has(family) || PERSON_ONLY_CAPS.test(cap);
}

/** Where an outside agent's call goes. open: it runs as the agent acting for the person, through the pipeline. ask: it waits for that person, and runs as them on their yes. paste: a key request the person
 *  fills in their own app. off: never from outside. */
export type OutsideDoor = "open" | "ask" | "paste" | "off";

/** The Vault's one door from outside: asking for a key by name, and always for the name only (never Use on it). A person pastes the value in their own app; it never reaches the agent. */
const VAULT_PASTE: ReadonlySet<string> = new Set(["vault.item.put", "vault.request"]);

export function outsideDoor(t: Pick<ToolDef, "cap" | "toolset" | "effects" | "local">): OutsideDoor {
  if (ALWAYS.has(t.cap)) return "open";
  if (t.local !== "none") return "off";
  if (t.toolset === "vault") return VAULT_PASTE.has(t.cap) ? "paste" : "off";
  if (OFF_TOOLSETS.has(t.toolset)) return "off";
  // the engineer tools read and change how the Space itself is set up: the person holds that role, or nobody here does. Reads too: the answer goes to a model Vyre cannot see.
  if (t.toolset === "engineer") return "ask";
  return isPersonOnly(t.cap, t.effects) ? "ask" : "open";
}

/** Runs as the agent itself. A tool that asks the person is not this. */
export function outsideAllows(t: Pick<ToolDef, "cap" | "toolset" | "effects" | "local">): boolean {
  return outsideDoor(t) === "open";
}

/**
 * The setup grant (owner ruling 3 Nov, docs/ask-the-person.md): "Act for me, including setup". With it, a call in this scope that the agent may not make itself runs as its person, without a card, the person's
 * role checked on the call. The scope is what setting a Space up takes: sign-in and SSO, members and invites, Connect your company, Console settings, connections and connectors, the Space's AI keys,
 * and putting keys in the Vault. Outside it, and for anything that goes out (sends, posts, payments), nothing changes. Never here: access, the Gate's rules, agents, MCP sign-ins, devices, the network,
 * reading a secret back, sharing a Vault item: an agent cannot give itself or another agent more than it has.
 */
const SETUP_FAMILIES = /^(members|company|settings|connections|connectors|import)\.|^(google|ms|microsoft)\.(dwd|tenant|connect|directory)(\.|_|$)/;
/** Loading up a company Space (lead review, 3 Nov): the Space itself, numbers, record types, groups and roles of people, journeys and automations, skills, channels, projects, members' calendars. */
const SETUP_PREFIXED = /^(telephony\.number\.(import|assign|list|get|search|set_hours|set_recording|set_route)|telephony\.registration\.(get|save|refresh)|schema\.(apply|layout\.set|set_label|gap_rules\.set|restore_field|describe|diff|infer|types\.|layout\.get|field_types|view_kinds|map|changes\.list|gap_rules\.list|trash\.list|sensitivity\.scan)|journeys\.(create|design|rename|rules\.set|start|move_stage|get|list|versions|stage_counts|preview_migrate|migrate)|automations\.(create|update|promote|preview_promote|set_enabled|validate|get|list|versions|steps\.list|triggers\.list|templates\.|groups\.|dependencies)|skills\.(add|remove|set_enabled|list)|channels\.(create|update|members\.|get|list|archive|unarchive)|projects\.(create|members\.set|members\.list|get|list|stages\.set|templates\.list|overview)|calendar\.(connect_provider|sync_now|list_calendars))/;
const SETUP_CAPS: ReadonlySet<string> = new Set([
  "vault.item.put", "vault.item.update", "vault.folders.create", "vault.folders.update", "vault.folders.list", "vault.items.list", "vault.request",
  // sharing a Vault item with people, a group of people or a role (never with an agent: setupRefusal), as the person would press Share
  "vault.share", "vault.unshare",
  "providers.add", "providers.list", "providers.catalog", "providers.test", "providers.set_space_use", "providers.remove",
  // the Space AI key (owner ruling 3 Nov: the setup grant covers the Space's AI key); the person's own role decides, as in Console
  "providers.space_key.get", "providers.space_key.set",
  // Space AI accounts (owner ruling 9): what each shared key pays for and its cap
  "providers.uses.set",
  "spaces.update", "spaces.get",
  // groups and roles, for people only: every subject is checked by setupRefusal
  "access.groups.create", "access.groups.update", "access.groups.add_member", "access.groups.remove_member", "access.groups.delete", "access.groups.list", "access.groups.get",
  "access.roles.assign", "access.roles.unassign", "access.roles.list", "access.roles.get",
]);
/** Within the scope, what never is: a step that hands an agent something, or reads one back. */
const SETUP_NEVER = /^(connectors\.(run|publish)|connections\.set_secret|automations\.(connector_share|connector_offer)|members\.sign_in_github\.get)/;
export function setupCovers(t: Pick<ToolDef, "cap" | "effects" | "local">): boolean {
  if (t.effects === "outward" || t.local !== "none" || SETUP_NEVER.test(t.cap)) return false;
  return SETUP_CAPS.has(t.cap) || SETUP_FAMILIES.test(t.cap) || SETUP_PREFIXED.test(t.cap);
}

/** The calls whose subjects are checked: a group or a role goes to people only under the setup grant. */
const PEOPLE_ONLY: ReadonlySet<string> = new Set(["access.groups.create", "access.groups.update", "access.groups.add_member", "access.roles.assign"]);
const subjectsOf = (input: unknown): Array<{ kind?: unknown; id?: unknown }> => {
  const i = (input ?? {}) as Record<string, unknown>;
  const list = (v: unknown): Array<{ kind?: unknown; id?: unknown }> => (Array.isArray(v) ? v : v !== undefined ? [v] : []) as Array<{ kind?: unknown; id?: unknown }>;
  return [...list(i["members"]), ...list(i["managers"]), ...list(i["member"]), ...list(i["subject"])];
};
/**
 * Why the setup grant does not cover this call, in a plain line, or null when it does. Groups and roles go to people only: a subject that is an agent, an actor, a service or a group (whose members may be
 * agents) is refused, so the grant can never widen an agent's own access. Checked where the call is classified, at the MCP door.
 */
export function setupRefusal(t: Pick<ToolDef, "cap">, input: unknown): string | null {
  // a Vault item is shared with people, a group of them or a role, as the person would; giving an agent, an actor or a service a key stays with the person
  if (t.cap === "vault.share") {
    const to = subjectsOf(input).find((x) => x === null || typeof x !== "object" || (x.kind !== "person" && x.kind !== "group" && x.kind !== "role"));
    return to === undefined ? null : "The setup grant shares Vault items with people, groups and roles only. Giving a key to an agent stays with a person: they press Share on the item in Vyre.";
  }
  if (!PEOPLE_ONLY.has(t.cap)) return null;
  const bad = subjectsOf(input).find((s) => s === null || typeof s !== "object" || s.kind !== "person");
  return bad === undefined ? null : "The setup grant gives groups and roles to people only. Putting an agent, actor, service or group in a group or a role stays with a person.";
}
