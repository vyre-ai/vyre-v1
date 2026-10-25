// The evaluation world for the 50-question proof set (spec 2.15, ARCH 6.10): a small studio with two agents, one project and one Space, plus the traps a memory must stay clear of:
// facts that were closed or removed, a proposed fact nobody accepted yet, and another person's private layer. Seed: the 0.6 scripts/eval-memory.js world, rewritten for facts and notes.
// Nothing here is a real person or firm.
import { seedFact, seedNote, DAY, NOW } from "./harness.ts";
import type { Harness, SeedFact } from "./harness.ts";

export const DANA = "usr_dana";
export const OMAR = "usr_omar";
export const INTAKE = "agt_intake";
export const BILLING = "agt_billing";
export const HARLOW = "prj_harlow";

const at = (daysAgo: number): number => NOW - daysAgo * DAY;

/** Current facts, by key (`w` Dana's own layer, `a` agent, `p` project, `s` Space, `b` billing agent). */
export const FACTS: SeedFact[] = [
  { id: "fct_w01", layer: "person", owner: DANA, agentId: INTAKE, kind: "preference", text: "Dana prefers meeting summaries as three short bullet points" },
  { id: "fct_w02", layer: "person", owner: DANA, agentId: INTAKE, kind: "preference", text: "Dana wants invoices sent on the first Monday of each month" },
  { id: "fct_w03", layer: "person", owner: DANA, agentId: INTAKE, kind: "profile", text: "Dana's timezone is Pacific and she starts work at 8 in the morning" },
  { id: "fct_w04", layer: "person", owner: DANA, agentId: INTAKE, kind: "note", text: "Dana's assistant is named Priya Nair and handles calendar conflicts" },
  { id: "fct_w05", layer: "person", owner: DANA, agentId: INTAKE, kind: "deadline", text: "The Harlow brand refresh is due on 14 November" },
  { id: "fct_w06", layer: "person", owner: DANA, agentId: INTAKE, kind: "decision", text: "Dana decided to move the newsletter from Mailchimp to Resend" },
  { id: "fct_w07", layer: "person", owner: DANA, agentId: INTAKE, kind: "preference", text: "Dana dislikes exclamation marks in client emails" },
  { id: "fct_w08", layer: "person", owner: DANA, agentId: INTAKE, kind: "profile", text: "Dana's favourite coffee order is an oat flat white" },
  { id: "fct_w09", layer: "person", owner: DANA, agentId: BILLING, kind: "decision", text: "Dana approves discounts up to 10 percent without asking" },
  { id: "fct_a01", layer: "agent", agentId: INTAKE, text: "Intake asks every new client for their website address, budget range and launch date" },
  { id: "fct_a02", layer: "agent", agentId: INTAKE, text: "Intake escalates urgent requests to Omar Haddad within one hour" },
  { id: "fct_a03", layer: "agent", agentId: INTAKE, text: "Refund requests above 500 dollars need a second approver" },
  { id: "fct_a04", layer: "agent", agentId: INTAKE, text: "Intake files signed contracts in the Contracts folder under the client name" },
  { id: "fct_a05", layer: "agent", agentId: INTAKE, text: "The onboarding call lasts forty five minutes and is booked through the Studio booking page" },
  { id: "fct_p01", layer: "project", projectId: HARLOW, text: "Harlow's primary brand colour is deep teal with copper accents" },
  { id: "fct_p02", layer: "project", projectId: HARLOW, text: "Harlow approves all copy through Fiona Walsh, their marketing lead" },
  { id: "fct_p03", layer: "project", projectId: HARLOW, text: "Harlow's website launch moved from October to 21 November" },
  { id: "fct_p04", layer: "project", projectId: HARLOW, text: "Harlow invoices are paid net 30 to the finance mailbox" },
  { id: "fct_s01", layer: "space", text: "The Studio office is closed on the last Friday of every month for planning" },
  { id: "fct_s02", layer: "space", text: "All client files are archived after 24 months of inactivity" },
  { id: "fct_s03", layer: "space", text: "The Studio uses Figma for design review and Linear for delivery tracking" },
  { id: "fct_s04", layer: "space", text: "Expense receipts must be uploaded within seven days" },
  { id: "fct_s05", layer: "space", text: "The Studio's main phone line forwards to the front desk after 5 pm" },
  { id: "fct_b01", layer: "agent", agentId: BILLING, text: "Billing runs the monthly invoice batch on the second business day" },
  { id: "fct_b02", layer: "agent", agentId: BILLING, text: "Late fees of 2 percent apply after 45 days" },
];

/** Facts a memory must never offer: closed, removed, proposed, and another person's private layer. */
export const TRAPS: SeedFact[] = [
  { id: "fct_c01", layer: "project", projectId: HARLOW, status: "closed", validFrom: at(90), validTo: at(20), text: "Harlow's website launch is set for October 3" },
  { id: "fct_c02", layer: "person", owner: DANA, agentId: INTAKE, status: "closed", validFrom: at(120), validTo: at(40), text: "Dana prefers meeting summaries as a long paragraph" },
  { id: "fct_c03", layer: "person", owner: DANA, agentId: INTAKE, status: "removed", text: "Dana's timezone is Eastern" },
  { id: "fct_c04", layer: "agent", agentId: BILLING, status: "closed", validFrom: at(200), validTo: at(60), text: "Late fees of 1 percent apply after 30 days" },
  { id: "fct_x01", layer: "agent", agentId: INTAKE, status: "proposed", text: "Intake should offer every new client a ten percent discount" },
  { id: "fct_o01", layer: "person", owner: OMAR, agentId: INTAKE, text: "Omar is interviewing at another company next week" },
  { id: "fct_o02", layer: "person", owner: OMAR, agentId: INTAKE, text: "Omar salary expectation is ninety thousand" },
];

export const NOTES = [
  { fileId: "fil_n01", title: "Client onboarding checklist", layer: "agent" as const, agentId: INTAKE, body: "Collect the website address, budget range and launch date. Book the onboarding call. File the signed contract." },
  { fileId: "fil_n02", title: "Escalation policy", layer: "agent" as const, agentId: INTAKE, body: "Urgent requests go to Omar Haddad within one hour. Refunds above 500 dollars need a second approver." },
  { fileId: "fil_n03", title: "Brand voice guide", layer: "agent" as const, agentId: INTAKE, body: "Warm, plain, no exclamation marks in client emails. Use short sentences." },
  { fileId: "fil_n04", title: "Harlow brand refresh plan", layer: "project" as const, projectId: HARLOW, body: "Teal and copper palette. Copy approvals by Fiona Walsh. Website launch 21 November." },
  { fileId: "fil_n05", title: "Studio handbook", layer: "space" as const, body: "The office is closed the last Friday of the month. Client files are archived after 24 months. Expense receipts within seven days." },
  { fileId: "fil_n06", title: "Billing calendar", layer: "agent" as const, agentId: BILLING, body: "Invoice batch on the second business day. Late fee of two percent after forty five days." },
];

/** Seed the whole world into a harness's database. */
export function seedWorld(h: Harness): void {
  for (const f of FACTS) seedFact(h, f);
  for (const f of TRAPS) seedFact(h, f);
  for (const n of NOTES) seedNote(h, n);
}

export const noteKey = (fileId: string): string => `note:not_${fileId.replace(/^fil_/, "")}`;
export const factKey = (id: string): string => `fact:${id}`;
