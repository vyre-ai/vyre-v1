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
};

const SYSTEM = "System step: the host, the scheduler, the engine or a provider's webhook calls it; a member never does.";
const PERSON = "A person's own act (their sign-in, their decision, their device or their key); an agent never makes it for them.";
const PROVIDER =
  "A provider's own primitive (its API account, webhook or raw send); agents use the Space's own tools (mail, chat, esign, files) that sit above it, with the Gate.";
const PUBLIC = "Public page for a visitor, no sign-in: the visitor's own act.";
const ERASE = "A governance erase or retention purge: a person with Manage runs it from the Console; never an agent.";
const CONSOLE = "Console set-up of the Space that a person does; an agent with the setup grant reaches the same ends with the tools above it.";
const COMPUTER = "Taking over or watching an agent's browser or terminal is the person's own act; the computer tools stay off from outside.";
const NOTES = "A person's Notes are theirs to label, pin, edit and share; an agent takes notes with notes.create and reads one with notes.get.";
const HOOKS = "Allowing or denying a hook's stop is the person's decision; an agent never answers a guard on itself.";

/** First match wins; a rule names why a capability has no MCP tool. */
export const NO_TOOL: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.(health|health_check)$|^health\.|\.jobs_health$|^reports(-client)?\./, SYSTEM],
  [/\.receive_(webhook|push|inbound|notification)$|\.hook$/, SYSTEM],
  [/^(scheduler|steps|webhooks|audit|engine|scheduler-api|sync|governance|state|steps-core|search|previews|logs|sources|mounts|events|updates|network|git|home|notifications|telephony\.ingest_|calendar\.|meetings|contacts\.|inbox\.link_message|mail\.(auto_connect|ingest|member_pause|status_update|unsubscribe)|runs\.(finish|mark_waiting|pin_version|record_|start|states|status)|tasks\.(clock|escalate|held_revise|withdraw)|journeys\.|goals\.(go|wake_claim)|automations\.(fire|code_reach)|chat\.(chapters_write|hook_|title_make|transcript\.(append|summar))|memory\.(archive_sweep|capture|index_graph|key\.resolve|maintain|pointer|recall\.|find_by_subject)|agents\.(assistant_of|config\.|memory_key|outside\.(enqueue|seen|usable|connect)|routine|share_class|snapshot)|connections\.mark_working|connectors\.(push|read|sync_poll|sync_run|complete_auth)|channels\.home_join|console\.assistant_context_set|notifications\.|projects\.shared_view|threads\.open_state|spaces\.image|plugins\.files|esign\.(health|hook)|files\.health|computers\.health|vault\.(report_scrub_miss|service_health|text_check|mark_signin_needed))/, SYSTEM],
  [/^(twilio|mailgun|resend|google|microsoft|ms|dropbox|dropbox-sign|dropbox_sign|providers|documenso|docusign|github|stripe|zoom|hubspot)\./, PROVIDER],
  [/^(identity|access|members|devices|gate|mcp|backup|portal|connections)\.|^sites\.(password_set|signin_link)$|^vault\.|^agents\.outside\./, PERSON],
  [/^(forms|bookings|esign\.signer_)/, PUBLIC],
  [/\.erase$|\.purge$|\.purge_trashed$|\.versions_purge$|\.transcript\.purge$|^memory\.notes\.erase$|^inbox\.item\.erase$|^mail\.message\.erase$|^telephony\.(call|sms)\.erase$|^records\.reveal$/, ERASE],
  [/^computers\.|^terminal\./, COMPUTER],
  [/^hooks\./, HOOKS],
  [/^notes\./, NOTES],
  [/^(skills\.(policy|space)\.|plugins\.connections\.policy_set|agents\.(connections|hooks|policy|space)\.|agents\.files$|automations\.key_hosts\.|browser\.(sites|cards|chrome)\.|connectors\.(check_key|for_service)|console\.|chat\.agent_dm\.mute|conflicts\.(log_binary|propose)|contacts-link\.)/, CONSOLE],
];

/** Why a capability has no tool, or null when it has none and no reason (a gap the parity test fails on). */
export function noToolReason(cap: string): string | null {
  for (const [re, why] of NO_TOOL) if (re.test(cap)) return why;
  return null;
}
