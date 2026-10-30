// Starter automations. Each one is a real definition built from catalogue steps and triggers, with nothing industry specific in it.
// "Use template" copies one into a Personal Draft. The blanks a person must fill before turning it on are listed in `setUp`.
import type { Definition } from "./projections.ts";

export interface Template {
  key: string;
  title: string;
  summary: string;
  /** What starts it, in plain words. */
  starts: string;
  /** What a person must choose or confirm before it can be turned on. */
  setUp: string[];
  definition: Definition;
}

export const TEMPLATES: readonly Template[] = [
  {
    key: "form_to_record_notify",
    title: "New form submission to record and message",
    summary: "When someone fills in a form, mark the record as new and tell a channel.",
    starts: "A form is submitted",
    setUp: ["Choose the form", "Choose the channel to tell"],
    definition: {
      triggers: [{ key: "form_submit", filter: {} }],
      nodes: [
        { id: "mark", key: "records.update", title: "Mark the record as new", input: { type: "{{ trigger.type }}", recordId: "{{ trigger.recordId }}", patch: { status: "new" } }, next: ["tell"] },
        { id: "tell", key: "post_message", title: "Tell the channel", input: { text: "A new {{ trigger.type }} came in from a form. Open record {{ trigger.recordId }} to follow up." } },
      ],
    },
  },
  {
    key: "weekly_digest",
    title: "Weekly digest",
    summary: "Every Monday morning, count what came in and send one short email.",
    starts: "Every Monday at 9:00",
    setUp: ["Choose the record type to count", "Choose the mailbox and who receives it", "Check the time zone"],
    definition: {
      triggers: [{ key: "schedule", config: { cron: "0 9 * * 1", timezone: "UTC", missed: "skip" } }],
      nodes: [
        { id: "recent", key: "records.find", title: "Find recent records", input: { type: "contact", limit: 100 }, next: ["send"] },
        { id: "send", key: "send_email", title: "Send the digest", input: { to: [], subject: "Weekly digest", body: "{{ steps.recent.out.count }} records are in view this week." } },
      ],
    },
  },
  {
    key: "approval_before_sending",
    title: "Approval before sending",
    summary: "Ask a person to approve a message. It is sent only if they say yes.",
    starts: "Run by hand",
    setUp: ["Choose who approves", "Choose the mailbox, the recipient and the message"],
    definition: {
      triggers: [{ key: "manual" }],
      nodes: [
        { id: "approve", key: "approval", title: "Ask for approval", input: { title: "Approve this message before it goes out", approver: { kind: "role", id: "rol_admin" }, timeout: "2d" }, next: ["decide"] },
        {
          id: "decide", key: "if", title: "Was it approved", input: { condition: "steps.approve.out.decision == \"approved\"" },
          branches: [{ label: "yes", to: "send" }, { label: "no", to: "end" }],
        },
        { id: "send", key: "send_email", title: "Send the message", input: { to: [], subject: "", body: "" } },
        { id: "end", key: "stop", title: "Stop without sending", input: {} },
      ],
    },
  },
  {
    key: "webhook_to_record",
    title: "Retry-safe webhook to record",
    summary: "Turn a posted request into a record. A failed write is tried again and never makes a second record.",
    starts: "A webhook is received",
    setUp: ["Choose the record type", "Match the fields to what the sender posts", "Copy the webhook address from the settings tab"],
    definition: {
      triggers: [{ key: "webhook" }],
      nodes: [
        {
          id: "make", key: "records.create", title: "Create the record",
          input: { type: "contact", fields: { name: "{{ trigger.body.name }}", email: "{{ trigger.body.email }}" } },
          onError: { mode: "retry", max: 3 },
        },
      ],
    },
  },
];

export function templateOf(key: string): Template | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
