// What an app or agent can reach through MCP (lane r42-mcp, 19 Nov 2026, owner: "everything a person can do, an agent can do"). Every capability a member can call is either a tool or sits on the list below with
// the reason it is not. The parity test (modules/mcp/tests/server.coverage.test.ts) fails on any capability that is neither, on a reason that matches nothing, and on a tool that is also on the list.
// Pure data: no clock, no I/O. A tool added here is deferred (found with tool_search, never in the short default list) and passes the same access check, Gate and audit as a person's press.
import type { Toolset } from "./types.ts";

/** Capabilities that become tools, with the toolset each lives in. */
export const MCP_TOOLS: Readonly<Record<string, Toolset>> = {
  "chat.history.search": "chats",
  "chat.question.withdraw": "chats",
  "chat.round.decide": "chats",
  "chat.round.discuss": "chats",
  "goals.brief": "tasks",
  "goals.checklist.tick": "tasks",
  "goals.number.set": "tasks",
  "memory.profile.add": "memory",
  "memory.profile.context": "memory",
  "memory.chat_learning.get": "memory",
  "memory.chat_learning.set": "memory",
  "memory.learning.today": "memory",
  "records.changes": "records",
  "records.counts": "records",
  "esign.remind": "files",
  "esign.verify": "files",
  "mail.send_as": "inbox",
  "settings.public_of": "meta",
  "plugins.hooks.list": "agents",
  "plugins.connections.policy": "agents",
  "runs.resume": "automations",
  "conflicts.assist": "meta",
  // Console set-up: admins' tools. What changes access, a connection or a key waits for a person's yes (MCP_HELD).
  "automations.key_hosts.allow": "automations",
  "automations.key_hosts.remove": "automations",
  "automations.key_hosts.pending": "automations",
  "automations.key_hosts.pending_bind": "automations",
  "browser.sites.set": "agents",
  "browser.sites.remove": "agents",
  "browser.cards.post": "agents",
  "chat.agent_dm.mute": "chats",
  "connectors.check_key": "engineer",
  "connectors.for_service": "engineer",
  "plugins.connections.policy_set": "engineer",
  "skills.policy.set": "engineer",
  "skills.space.adopt": "engineer",
  "skills.space.setup": "engineer",
  "skills.space.update": "engineer",
  "hooks.policy.get": "engineer",
  "hooks.policy.set": "engineer",
  "hooks.pause": "engineer",
  "hooks.allow_always": "engineer",
  "hooks.allow_once": "engineer",
  "hooks.allow_remove": "engineer",
  "hooks.deny": "engineer",
  "hooks.ask_admin": "engineer",
  // erase and purge: always held for a person's explicit yes
  "channels.erase": "chats",
  "threads.erase": "chats",
  "chat.transcript.purge": "chats",
  "files.versions_purge": "files",
  "inbox.item.erase": "inbox",
  "mail.message.erase": "inbox",
  "telephony.call.erase": "inbox",
  "telephony.sms.erase": "inbox",
  "memory.notes.erase": "memory",
  "records.purge": "records",
  "records.purge_trashed": "records",
  "runs.erase": "automations",
  "runs.purge": "automations",
  // a person's things that an agent may do for them
  "notes.list": "memory",
  "notes.label": "memory",
  "notes.pin": "memory",
  "notes.update": "memory",
  "notes.image": "memory",
  "access.automation_senders": "engineer",
  "access.join_share": "engineer",
  "backup.export_start": "engineer",
  "backup.restore": "engineer",
  "gate.allow.list": "engineer",
  "gate.allow.set": "engineer",
  "gate.allow.remove": "engineer",
  "gate.links.known": "engineer",
  "mcp.connected.list": "meta",
  "mcp.connected.remove": "meta",
  "members.invites.guest": "engineer",
  "sites.password_set": "sites",
};

/** The Gate act that holds an agent's call for a person's yes, for a capability that had no gate of its own. Added when the capability became a tool; a person's own press is never held. */
export const MCP_HELD: Readonly<Record<string, string>> = {
  "automations.key_hosts.allow": "connection_change",
  "automations.key_hosts.remove": "connection_change",
  "browser.sites.set": "connection_change",
  "browser.sites.remove": "connection_change",
  "plugins.connections.policy_set": "connection_change",
  "skills.policy.set": "connection_change",
  "skills.space.adopt": "connection_change",
  "skills.space.setup": "connection_change",
  "skills.space.update": "connection_change",
  "hooks.policy.set": "approve",
  "hooks.pause": "approve",
  "hooks.allow_always": "approve",
  "hooks.allow_once": "approve",
  "hooks.allow_remove": "approve",
  "hooks.deny": "approve",
  "channels.erase": "delete",
  "threads.erase": "delete",
  "chat.transcript.purge": "delete",
  "files.versions_purge": "delete",
  "inbox.item.erase": "delete",
  "mail.message.erase": "delete",
  "telephony.call.erase": "delete",
  "telephony.sms.erase": "delete",
  "memory.notes.erase": "delete",
  "records.purge": "delete",
  "records.purge_trashed": "delete",
  "runs.erase": "delete",
  "runs.purge": "delete",
  "access.join_share": "signin_change",
  "access.automation_senders": "signin_change",
  "backup.export_start": "approve",
  "gate.allow.set": "approve",
  "gate.allow.remove": "approve",
  "mcp.connected.remove": "signin_change",
  "members.invites.guest": "signin_change",
  "sites.password_set": "signin_change",
};

const SYSTEM = "System step: the host, the scheduler, the engine or a provider's webhook calls it; a member never does.";
const CREDENTIAL = "Sign-in and credentials: a person's own password, sign-in, device trust, recovery or key. It never runs for them.";
const GATE = "The Gate's own answer or bookkeeping: an agent never answers, releases or loosens the hold on its own act.";
const PROVIDER =
  "A provider's own primitive (its API account, webhook or raw send); agents use the Space's own tools (mail, chat, esign, files) that sit above it, with the Gate.";
const PUBLIC = "Public page for a visitor, no sign-in: the visitor's own act.";
const SEALED = "A sealed value is revealed to a person, one at a time; it never reaches an agent.";
const PRESS = "Answering a held card, or a card's own button, is the person's press.";
const COMPUTER = "Taking over an agent's browser or terminal by a human, and the live view of it, is the person's own act; the computer tools stay off from outside.";

/** First match wins; a rule names why a capability has no MCP tool. A capability in MCP_TOOLS has none. */
export const NO_TOOL: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.(health|health_check)$|^health\.|\.jobs_health$|^reports(-client)?\./, SYSTEM],
  [/\.receive_(webhook|push|inbound|notification)$|\.hook$/, SYSTEM],
  [/^(access\.(exceptions\.lapse|projection_health)|hooks\.fire|scheduler|steps|webhooks|audit|engine|scheduler-api|sync|governance|state|steps-core|search|previews|logs|sources|mounts|events|updates|network|git|home|notifications|telephony\.ingest_|calendar\.|meetings|contacts\.|inbox\.link_message|mail\.(auto_connect|ingest|member_pause|status_update|unsubscribe)|runs\.(finish|mark_waiting|pin_version|record_|start|states|status)|tasks\.(clock|escalate|held_revise|withdraw)|journeys\.|goals\.(go|wake_claim)|automations\.(fire|code_reach)|chat\.(chapters_write|hook_|title_make|transcript\.(append|summar))|memory\.(archive_sweep|capture|index_graph|key\.resolve|maintain|pointer|recall\.|find_by_subject)|agents\.(assistant_of|config\.|memory_key|outside\.|routine|share_class|snapshot)|connections\.mark_working|connectors\.(push|read|sync_poll|sync_run|complete_auth)|channels\.home_join|console\.assistant_context_set|notifications\.|projects\.shared_view|threads\.open_state|spaces\.image|plugins\.files|esign\.(health|hook)|files\.health|computers\.health|vault\.(report_scrub_miss|service_health|text_check|mark_signin_needed))/, SYSTEM],
  [/^(identity|devices)\.|^connections\.complete_auth$|^mcp\.(oauth\.|session\.mint|setup\.set)|^portal\.|^sites\.signin_link$|^access\.actors\.redeem$|^members\.|^vault\./, CREDENTIAL],
  [/^gate\./, GATE],
  [/^(twilio|mailgun|resend|google|microsoft|ms|dropbox|dropbox-sign|dropbox_sign|providers|documenso|docusign|github|stripe|zoom|hubspot)\./, PROVIDER],
  [/^(forms|bookings|esign\.signer_)/, PUBLIC],
  [/^records\.reveal$/, SEALED],
  [/^browser\.chrome\.act$|^conflicts\.(log_binary|propose)$/, PRESS],
  [/^computers\.|^terminal\./, COMPUTER],
];

/** Why a capability has no tool, or null when it is a tool or has none and no reason (a gap the parity test fails on). */
export function noToolReason(cap: string): string | null {
  if (cap in MCP_TOOLS) return null;
  for (const [re, why] of NO_TOOL) if (re.test(cap)) return why;
  return null;
}
