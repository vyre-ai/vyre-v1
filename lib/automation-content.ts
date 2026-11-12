// What a stranger can start, and what their words may not do (lead 12 Nov, runs-as review pass 3). An Automation's Run is "from outside" unless its trigger is one only people in the Space
// press or a clock sets: everything else (an email, a form, a webhook, a chat message, a record or a spreadsheet row someone else changed, a meeting transcript, a CI check, a journey stage, and any
// trigger added later) carries text someone outside may have written. Such a Run's task thread is marked (the engine's task baton writes "automation:<automationId>:<person>"), its brief fences the
// trigger and inputs as data, and the capabilities below are held for a yes when an agent calls them in that thread: they give someone access, or keep the stranger's words for later turns.

/** Triggers only people in the Space or a clock set. Every other trigger is from outside, including ones added later. */
export const INTERNAL_TRIGGERS: ReadonlySet<string> = new Set(["schedule", "manual", "button"]);
export const isOutsideTrigger = (trigger: string | undefined): boolean => !INTERNAL_TRIGGERS.has(trigger ?? "");

/** How a card and a brief name a trigger, in plain words. */
const TRIGGER_WORDS: Readonly<Record<string, string>> = {
  email_received: "email", form_submit: "form", webhook: "webhook", chat_message: "chat message", record_change: "record change", spreadsheet_row: "spreadsheet row",
  meeting_transcript_ready: "meeting transcript", ci_check: "CI check", journey_stage_entered: "journey stage", journey_stage_left: "journey stage",
  agent_run: "started by an agent",
};
export const triggerWords = (trigger: string | undefined): string => TRIGGER_WORDS[trigger ?? ""] ?? "outside trigger";

/** The mark on an outside-started Run's task thread, and on any thread its agent starts from there: "automation:<automationId>:<trigger>:<person the work acts for>". */
export const AUTOMATION_MARK = "automation:";
export const automationMark = (automationId: string, trigger: string, person: string): string => `${AUTOMATION_MARK}${automationId}:${trigger}:${person}`;
/** The automation and trigger a mark names, or null. */
export function readAutomationMark(source: string | undefined): { automationId: string; trigger: string } | null {
  const m = /^automation:(aut_[a-z0-9]+):([a-z_]*):/.exec(source ?? "");
  return m ? { automationId: m[1]!, trigger: m[2]! } : null;
}

/**
 * Held with act "approve" when an agent calls one in a thread whose chain carries an uncleared Automation mark (host/src/daemon/gate-hook.ts). Giving access, then keeping words for later.
 * test/automation-content.test.ts checks every name is a capability with its own hold words, so a rename cannot drop one silently.
 */
export const HELD_FROM_AUTOMATION_CONTENT: readonly string[] = [
  // giving someone access
  "access.share", "access.grants.update", "access.groups.add_member", "access.audience_set", "access.requests.approve", "access.roles.assign", "access.actors.create",
  "access.groups.create", "access.groups.defaults_set", "vault.share", "files.share", "chat.share", "notes.share",
  "members.invites.create", "members.invites.extend", "members.join_link.create", "members.join_requests.approve", "members.reactivate", "projects.members.set",
  "skills.share", "skills.grant", "portal.account_create", "portal.file_link", "portal.post", "webhooks.create", "webhooks.update", "memory.page.set_visibility",
  "sites.publish", "sites.artifact_publish",
  // the outer call, so nothing is half done before the card (a nested share inside these is not held on its own)
  "threads.members.add", "channels.members.add", "threads.add_agent", "changesets.review_externally",
  // starting another Automation's Run with the stranger's text as its payload
  "automations.run",
  // keeping the stranger's words for later turns
  "automations.create", "automations.update", "automations.set_enabled", "automations.restore_version", "automations.templates.use", "automations.packages.import",
  "automations.make_personal_copy", "agents.create", "agents.update", "agents.instruction.append", "agents.routine.save", "agents.routine.delegate", "channels.agent_watch.set",
  "goals.create", "hooks.set", "install.from_link", "skills.save", "skills.mine.add", "skills.mine.remove", "skills.mine.set", "skills.mine.update", "skills.add", "skills.space.install",
  "plugins.agent_template.use", "plugins.allow.set", "plugins.config.set", "plugins.connection.add", "plugins.connection.add_mine", "plugins.connection.checked", "plugins.connection.forget",
  "plugins.connection.remove", "plugins.connection.update", "plugins.connections.policy_set", "plugins.install", "plugins.marketplace.add", "plugins.marketplace.refresh",
  "plugins.marketplace.remove", "plugins.set_enabled", "plugins.uninstall",
];
export const HELD_FROM_AUTOMATION_SET: ReadonlySet<string> = new Set(HELD_FROM_AUTOMATION_CONTENT);

/**
 * Capabilities whose call makes a new thread for the work (a task, a helper, a crew job, a chat or channel it starts). Only these carry the Run's mark onto a thread, and only onto a thread made
 * by that very call: a read that names threads (a task or chat list, a search) never marks anything (runs-as review pass 4b). test/automation-content.test.ts checks every capability that
 * announces a new thread or task is here or in NOT_CARRYING, so a new one cannot be forgotten silently.
 */
export const CARRIES_MARK: ReadonlySet<string> = new Set([
  "tasks.create", "tasks.plan", "tasks.ask", "tasks.block", "chat.start", "chat.helper.start", "chat.aside", "chat.fork", "chat.handoff", "chat.thread", "channels.create", "engine.crew.start",
]);
/** Capabilities that announce a thread but do not carry the mark, and why. */
export const NOT_CARRYING: Readonly<Record<string, string>> = {
  "chat.message_person": "a direct message to a teammate, which may reuse their existing chat; a post into another chat does not mark it (lead 12 Nov)",
  "channels.home_join": "joins the Space's home channel, which other people use",
  "projects.open_task_thread": "opens the thread of a task that already exists",
};
