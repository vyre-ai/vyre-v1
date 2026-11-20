// What an app or agent can reach through MCP (lane r42-mcp, 19 Nov 2026, owner: "everything a person can do, an agent can do"). Every capability a member can call is either a tool or sits on the list below with
// the reason it is not. The parity test (modules/mcp/tests/server.coverage.test.ts) fails on any capability that is neither, on a reason that matches nothing, and on a tool that is also on the list.
// Pure data: no clock, no I/O. A tool added here is deferred (found with tool_search, never in the short default list) and passes the same access check, Gate and audit as a person's press.
import type { Toolset } from "./types.ts";

/** Capabilities that become tools, with the toolset each lives in. */
export const MCP_TOOLS: Readonly<Record<string, Toolset>> = {
  "chat.history.search": "chats",
  "chat.round.decide": "chats",
  "goals.brief": "tasks",
  "goals.checklist.tick": "tasks",
  "memory.profile.add": "memory",
  "memory.chat_learning.set": "memory",
  "records.changes": "records",
  "records.counts": "records",
  "esign.remind": "files",
  "esign.verify": "files",
  "mail.send_as": "inbox",
  "chat.transcript.purge": "chats",
  "files.versions_purge": "files",
  "browser.sites.set": "agents",
  "runs.resume": "automations",
  // Console set-up: admins' tools. What changes access, a connection or a key waits for a person's yes (MCP_HELD).
  "automations.key_hosts.allow": "automations",
  "automations.key_hosts.remove": "automations",
  "browser.sites.remove": "agents",
  "connectors.for_service": "engineer",
  "skills.policy.set": "engineer",
  "skills.space.adopt": "engineer",
  "skills.space.setup": "engineer",
  "skills.space.update": "engineer",
  "hooks.policy.get": "engineer",
  "hooks.policy.set": "engineer",
  "hooks.pause": "engineer",
  // erase and purge: always held for a person's explicit yes
  "channels.erase": "chats",
  "threads.erase": "chats",
  "inbox.item.erase": "inbox",
  "mail.message.erase": "inbox",
  "telephony.call.erase": "inbox",
  "telephony.sms.erase": "inbox",
  "memory.notes.erase": "memory",
  "records.purge": "records",
  "records.purge_trashed": "records",
  "runs.erase": "automations",
  // a person's things that an agent may do for them
  "notes.list": "memory",
  "notes.pin": "memory",
  "notes.update": "memory",
  "backup.export_start": "engineer",
  "gate.allow.list": "engineer",
  "mcp.connected.list": "meta",
  "sites.password_set": "sites",
};

/** The Gate act that holds an agent's call for a person's yes, for a capability that had no gate of its own. Added when the capability became a tool; a person's own press is never held. */
export const MCP_HELD: Readonly<Record<string, string>> = {
  "automations.key_hosts.allow": "connection_change",
  "automations.key_hosts.remove": "connection_change",
  "browser.sites.remove": "connection_change",
  "browser.sites.set": "connection_change",
  "skills.policy.set": "connection_change",
  "skills.space.adopt": "connection_change",
  "skills.space.setup": "connection_change",
  "skills.space.update": "connection_change",
  "hooks.policy.set": "approve",
  "hooks.pause": "approve",
  "channels.erase": "delete",
  "chat.transcript.purge": "delete",
  "files.versions_purge": "delete",
  "threads.erase": "delete",
  "inbox.item.erase": "delete",
  "mail.message.erase": "delete",
  "telephony.call.erase": "delete",
  "telephony.sms.erase": "delete",
  "memory.notes.erase": "delete",
  "records.purge": "delete",
  "records.purge_trashed": "delete",
  "runs.erase": "delete",
  "sites.password_set": "signin_change",
};

const SYSTEM =
  "System step: the host, the scheduler, the engine or a provider's webhook calls it; a member never does.";
const CREDENTIAL =
  "Sign-in and credentials: a person's own password, sign-in, device trust, recovery or key. It never runs for them.";
const GATE =
  "The Gate's own answer or bookkeeping: an agent never answers, releases or loosens the hold on its own act.";
const PROVIDER =
  "A provider's own primitive (its API account, webhook or raw send); agents use the Space's own tools (mail, chat, esign, files) that sit above it, with the Gate.";
const PUBLIC = "Public page for a visitor, no sign-in: the visitor's own act.";
const SEALED = "A sealed value is revealed to a person, one at a time; it never reaches an agent.";
const PRESS = "Answering a held card, or a card's own button, is the person's press.";
const NOTES = "A note's labels are the person's own filing; an agent edits the note (notes_update).";
const LOW =
  "A reading no agent needs to write a call (a quota number, a teammate's profile line, a policy it cannot act on): the person sees it in Settings or the Console.";
const APP = "App plumbing: the app's own screen reads it to draw a card or a tile; an agent has no use for it.";
const VIA_MAIL_CONFIGURE =
  "An agent reaches it through the mail_configure tool (actions status, test, smtp_get, smtp_set, smtp_verify, address_list, address_add, address_move); the Gate, permission and audit apply as when a person presses the button.";
const VIA_SITES_OPS =
  "An agent reaches it through the sites_ops tool (actions logs, metrics, jobs, job_*, worker_*, backups, backup_*); the site's lock, ownership checks and the Gate apply as for a person.";
const DOC_SIGNING =
  "System call: esign.send asks it for a PDF's signing places and exact-copy state; agents get the roles from documents_make (signers) and esign_send.";
const SERVICES_LIST =
  "Its answer is part of the sites_ops jobs action: the workers come back beside the jobs, so an agent reads them there.";
const VIA_TASKS_UPDATE =
  "An agent sets, changes or clears what proves a task done through tasks_update (doneWhen, kind:name); the app's own card calls this one.";
const VIA_TASKS_ARCHIVE =
  "An agent puts an archived task back through tasks_archive (back: true); the app's Put back calls this one.";
const COMPUTER =
  "Taking over an agent's browser or terminal by a human, and the live view of it, is the person's own act; the computer tools stay off from outside.";

/** First match wins; a rule names why a capability has no MCP tool. A capability in MCP_TOOLS has none. */
export const NO_TOOL: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.(health|health_check)$|^health\.|\.jobs_health$|^reports(-client)?\./, SYSTEM],
  [/\.receive_(webhook|push|inbound|notification)$|\.hook$/, SYSTEM],
  [
    /^(access\.(exceptions\.lapse|projection_health|join_share)|members\.invites\.guest$|hooks\.fire|scheduler|steps|webhooks|audit|engine|scheduler-api|sync|governance|state|steps-core|search|previews|logs|sources|mounts|events|updates|network|git|home|notifications|telephony\.ingest_|calendar\.|meetings|contacts\.|inbox\.link_message|mail\.(auto_connect|ingest|member_pause|status_update|unsubscribe)|runs\.(finish|mark_waiting|pin_version|record_|start|states|status)|tasks\.(clock|escalate|held_revise|withdraw)|journeys\.|goals\.(go|wake_claim)|automations\.(fire|code_reach)|chat\.(chapters_write|hook_|title_make|transcript\.(append|summar))|memory\.(archive_sweep|capture|index_graph|key\.resolve|maintain|pointer|recall\.|find_by_subject|profile\.context)|agents\.(assistant_of|config\.|memory_key|outside\.|routine|share_class|snapshot)|connections\.mark_working|connectors\.(push|read|sync_poll|sync_run|complete_auth)|channels\.home_join|console\.assistant_context_set|notifications\.|projects\.shared_view|threads\.open_state|spaces\.image|plugins\.files|esign\.(health|hook)|files\.health|computers\.health|vault\.(report_scrub_miss|service_health|text_check|mark_signin_needed))/,
    SYSTEM,
  ],
  [
    /^(identity|devices)\.|^connections\.complete_auth$|^mcp\.(oauth\.|session\.mint|setup\.set|connected\.remove)|^portal\.|^sites\.signin_link$|^access\.actors\.redeem$|^members\.|^vault\./,
    CREDENTIAL,
  ],
  [/^gate\.links\.known$/, SYSTEM],
  [/^gate\.|^hooks\.(allow_|deny|ask_admin)/, GATE],
  [/^automations\.key_hosts\.pending|^access\.automation_senders$/, PRESS],
  [/^notes\.(label|image)$/, NOTES],
  [
    /^(chat\.agent_dm\.mute|memory\.chat_learning\.get|connectors\.check_key|plugins\.connections\.policy_set|backup\.restore|runs\.purge|goals\.number\.set|browser\.cards\.post|chat\.round\.discuss|chat\.question\.withdraw|memory\.learning\.today|settings\.public_of|conflicts\.assist|plugins\.hooks\.list|plugins\.connections\.policy)$/,
    LOW,
  ],
  [
    /^(twilio|mailgun|resend|google|microsoft|ms|dropbox|dropbox-sign|dropbox_sign|providers|documenso|docusign|github|stripe|zoom|hubspot)\./,
    PROVIDER,
  ],
  [/^(forms|bookings|esign\.signer_)/, PUBLIC],
  [/^records\.reveal$/, SEALED],
  [/^browser\.chrome\.act$|^conflicts\.(log_binary|propose)$/, PRESS],
  [/^computers\.|^terminal\./, COMPUTER],
  // classified 20 Nov 2026 (rc.43 integration), each from what the code does: the server's own calls, a person's card, app plumbing, and the calls an agent already reaches through a grouped tool
  [
    /^access\.folder_narrow$|^sites\.head_check$|^runs\.node\.(beat|claim|reclaim|event|label|move|start)$|^runs\.message\.(seen|take)$/,
    SYSTEM,
  ],
  [/^documents\.signing$/, DOC_SIGNING],
  [/^sites\.services_list$/, SERVICES_LIST],
  [/^tasks\.(still_answer|still_needed)$/, PRESS],
  [/^tasks\.changes$/, APP],
  [/^tasks\.done_when$/, VIA_TASKS_UPDATE],
  [/^tasks\.unarchive$/, VIA_TASKS_ARCHIVE],
  [/^mail\.(setup\.(status|test_send)|smtp\.(get|set|verify)|address\.(list|add|move))$/, VIA_MAIL_CONFIGURE],
  [/^sites\.(logs_read|metrics|jobs?_[a-z]+|service_(add|restart|stop|remove)|backups?_[a-z]+)$/, VIA_SITES_OPS],
];

/** Why a capability has no tool, or null when it is a tool or has none and no reason (a gap the parity test fails on). */
export function noToolReason(cap: string): string | null {
  if (cap in MCP_TOOLS) return null;
  for (const [re, why] of NO_TOOL) if (re.test(cap)) return why;
  return null;
}
