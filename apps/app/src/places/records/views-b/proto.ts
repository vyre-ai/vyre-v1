// The shared Northwind Space for the Records views (ruling: the sidebar and the views read the prototype's numbers, not the old local sample): Clients 1,240, Projects 270, Agents 5,
// Invoices 2,120, Meetings 652, Tasks 931, Hires 2, Messages 5, built over the shared fixtures' clients (fixtures/prototype-clients.ts). Today is Oct 24, 2026, as the prototype's.
// Meetings follow the prototype's generator (a kind and a client, on a weekday within the months around today), Projects have a stage, a start and a due date so the Timeline has bars.
import type { Row } from "../../../../../../client/src/index.ts";
import { protoClients } from "../../../fixtures/prototype-clients.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";
import { protoNorthwindSpace } from "../table/sample.ts";
import type { SampleSpace } from "../table/sample.ts";
import { LOCATIONS_DEF, PLACES, location } from "./sample.ts";

const DAY = 86_400_000;
export const PROTO_TODAY = Date.UTC(2026, 9, 24);
const f = (key: string, type: string, title: string, options?: Record<string, unknown>): FieldDef => ({ key, type, title, ...(options ? { options } : {}) });
const choices = (...c: [string, string, string?][]): Record<string, unknown> => ({ choices: c.map(([key, title, color]) => ({ key, title, ...(color ? { color } : {}) })) });
const stages = (...c: [string, string][]): Record<string, unknown> => ({ stages: c.map(([key, title]) => ({ key, title })) });
const def = (key: string, title: string, plural: string, icon: string, titleField: string, fields: FieldDef[], o: Partial<TypeDef> = {}): TypeDef => ({ key, title, plural, icon, label: "internal", system: false, titleField, fields, version: 1, ...o });

const KINDS = ["Consult", "Check-in", "Check-in", "Review", "Signing"] as const;
const STAGES = ["intake", "engaged", "review", "done"] as const;
const WORK = ["engagement", "annual review", "document set", "transfer", "renewal", "onboarding"] as const;
const TEAM = ["usr_maya", "usr_omar", "usr_lena", "usr_sam", "usr_irfad"] as const;

/** A repeatable pseudo-random, so the Space is the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const MEETINGS = def("meetings", "Meeting", "Meetings", "calendar", "title", [f("title", "text", "Title"), f("when", "datetime", "When"), f("kind", "choice", "Kind", choices(["consult", "Consult", "270"], ["check-in", "Check-in", "205"], ["review", "Review", "35"], ["signing", "Signing", "145"])), f("host", "person", "Host")], { system: true });
const PROJECTS = def("projects", "Project", "Projects", "project", "name", [f("name", "text", "Name"), f("status", "status", "Stage", stages(["intake", "Intake"], ["engaged", "Engaged"], ["review", "In review"], ["done", "Done"])), f("lead", "person", "Lead"), f("start", "date", "Start"), f("due", "date", "Due"), f("budget", "money", "Budget")], { system: true, template: "project", group: "Projects" });
const SIMPLE = (key: string, title: string, plural: string, icon: string): TypeDef => def(key, title, plural, icon, "name", [f("name", "text", "Name"), f("status", "choice", "Status", choices(["open", "Open", "150"], ["closed", "Closed"]))], { system: true });

export const PROTO_COUNTS: Readonly<Record<string, number>> = { clients: 1240, projects: 270, agents: 5, invoices: 2120, meetings: 652, tasks: 931, hires: 2, messages: 5, locations: PLACES.length };

export function protoMeeting(i: number, names: readonly string[]): RecordRow {
  const r = rng(1000 + i);
  let day = Math.floor(r() * 150) - 75;
  const base = new Date(PROTO_TODAY + day * DAY);
  if (base.getUTCDay() === 0) day += 1; else if (base.getUTCDay() === 6) day -= 1;
  const kind = KINDS[Math.floor(r() * KINDS.length)]!;
  const hour = 9 + Math.floor(r() * 8), half = r() < 0.5 ? 0 : 30 * 60_000;
  const when = PROTO_TODAY + day * DAY + hour * 3_600_000 + half;
  return { id: `meetings_${i}`, type: "meetings", version: 1, label: 1, createdAt: when - DAY, updatedAt: when - DAY, holds: 0, fields: { title: `${kind} · ${names[Math.floor(r() * names.length)]}`, when, kind: kind.toLowerCase(), host: TEAM[Math.floor(r() * TEAM.length)] } } as unknown as RecordRow;
}

export function protoProject(i: number, names: readonly string[]): RecordRow {
  const r = rng(5000 + i);
  const who = (names[Math.floor(r() * names.length)] ?? "Client").split(" ").pop()!;
  const start = PROTO_TODAY + (Math.floor(r() * 120) - 45) * DAY;
  const stage = STAGES[i % STAGES.length]!;
  return { id: `projects_${i}`, type: "projects", version: 1, label: 1, createdAt: start - 20 * DAY, updatedAt: start, holds: 0, fields: { name: `${who} ${WORK[i % WORK.length]}`, status: stage, lead: TEAM[i % TEAM.length], start, due: start + (14 + Math.floor(r() * 50)) * DAY, budget: { amount: 2000 + Math.floor(r() * 9) * 750, currency: "USD" } } } as unknown as RecordRow;
}

/** Northwind as the prototype shows it: the shared fixtures' types and counts. The rows of the big types are made by `fillProto`. */
export function protoViewsSpace(): SampleSpace {
  const base = protoNorthwindSpace;
  const clients = base.types.find((t) => t.key === "clients") as TypeDef;
  return {
    ...base,
    types: [clients, PROJECTS, SIMPLE("agents", "Agent", "Agents", "agent"), SIMPLE("invoices", "Invoice", "Invoices", "invoice"), MEETINGS, def("tasks", "Task", "Tasks", "task", "name", [f("name", "text", "Name"), f("status", "status", "Status", stages(["todo", "To do"], ["doing", "Doing"], ["done", "Done"])), f("start", "date", "Start"), f("due", "date", "Due")], { system: true }), SIMPLE("hires", "Hire", "Hires", "person"), SIMPLE("messages", "Message", "Messages", "message"), LOCATIONS_DEF],
    counts: { ...PROTO_COUNTS },
    views: [],
  };
}

/** Rows for the types the Records views draw: projects and meetings in the prototype's amounts, tasks and locations as before. */
export function protoRows(): { projects: Row[]; meetings: Row[]; locations: Row[] } {
  const names = protoClients().slice(0, 400).map((c) => c.name);
  return {
    projects: Array.from({ length: PROTO_COUNTS["projects"] as number }, (_, i) => protoProject(i, names) as unknown as Row),
    meetings: Array.from({ length: PROTO_COUNTS["meetings"] as number }, (_, i) => protoMeeting(i, names) as unknown as Row),
    locations: Array.from({ length: PLACES.length }, (_, i) => location(i) as unknown as Row),
  };
}
