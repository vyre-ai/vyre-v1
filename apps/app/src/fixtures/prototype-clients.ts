// The prototype's Northwind Clients, regenerated the way the prototype does it: mulberry32 seeded 2026, the six hand-written clients first, then 1,234 drawn ones, then the first and latest
// channel from the prototype's hash. Every constant comes from prototype-data.ts (extracted from the prototype copy). prototype-source.test.ts runs the prototype's own code and compares.

import { PROTO_AGS, PROTO_CHN, PROTO_CHW, PROTO_CITIES, PROTO_FIRST, PROTO_HAND, PROTO_HI, PROTO_HM, PROTO_HP, PROTO_HT, PROTO_KINDS, PROTO_LAST, PROTO_NEXTS, PROTO_STREETS, PROTO_TASKT, PROTO_TEAM } from "./prototype-data.ts";

export interface ProtoClient {
  id: string;
  name: string;
  status: string;
  owner: string;
  fit: number | null;
  /** ISO date, "2026-10-23". */
  since: string;
  source: string;
  /** First and latest channel names (Referral, Paid search ...). */
  fch: string;
  lch: string;
}

const strs = (a: readonly unknown[]): readonly string[] => a as readonly string[];
const pad = (n: number): string => String(n).padStart(2, "0");

/** The prototype's hash. */
export function protoHash(s: string): number {
  let h = 7;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The prototype's addDays for a date-only string, in UTC so every machine agrees. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The channel a unit draw falls in (prototype pickCh). */
export function pickChannel(u: number): string {
  let s = 0;
  for (let i = 0; i < PROTO_CHW.length; i++) {
    s += PROTO_CHW[i] as number;
    if (u < s) return (PROTO_CHN[i] as readonly [string, number | null])[0];
  }
  return "Direct";
}

export const PROTO_CLIENT_COUNT = 1240;

export interface ProtoProject { id: string; title: string; client: string; stage: string; lead: string; start: string; due: string; budget: number; tags: readonly string[] }
export interface ProtoInvoice { id: string; no: string; client: string; project: string | null; amount: number; status: string; issued: string; due: string; method: string }
export interface ProtoMeeting { id: string; title: string; when: string; client: string; host: string; kind: string; done: boolean; notes: string }
export interface ProtoTask { id: string; title: string; project: string; assignee: string; status: string; due: string; done: boolean }
export interface ProtoWork { projects: readonly ProtoProject[]; invoices: readonly ProtoInvoice[]; meetings: readonly ProtoMeeting[]; tasks: readonly ProtoTask[] }

/** The prototype's "today" and "now" (its TODAY and NOWT). */
export const PROTO_TODAY = "2026-10-24";
export const PROTO_NOW = "2026-10-24T09:41";

let cached: readonly ProtoClient[] | null = null;
let cachedWork: ProtoWork | null = null;

/** All 1,240 clients, in the prototype's order. */
export function protoClients(): readonly ProtoClient[] {
  if (cached) return cached;
  const R = mulberry32(2026);
  const ri = (n: number): number => (R() * n) | 0;
  const pk = <T,>(a: readonly T[]): T => a[ri(a.length)] as T;
  const wt = (a: readonly (readonly [string, number])[]): string => {
    const x = R();
    let s = 0;
    for (const [v, w] of a) { s += w; if (x < s) return v; }
    return (a[a.length - 1] as readonly [string, number])[0];
  };
  const hex = (): string => ri(0xfffff).toString(16).padStart(5, "0");
  const FIRST = strs(PROTO_FIRST), LAST = strs(PROTO_LAST), TEAM = strs(PROTO_TEAM), STREETS = strs(PROTO_STREETS), CITIES = strs(PROTO_CITIES), NEXTS = strs(PROTO_NEXTS);
  const hand = PROTO_HAND as readonly Record<string, unknown>[];
  const out: ProtoClient[] = [];
  for (let i = 0; i < PROTO_CLIENT_COUNT; i++) {
    let r: Omit<ProtoClient, "id" | "fch" | "lch">;
    if (i < hand.length) {
      const h = hand[i] as Record<string, unknown>;
      r = { name: h["name"] as string, status: h["status"] as string, owner: h["owner"] as string, fit: (h["fit"] as number | null) ?? null, since: h["since"] as string, source: h["source"] as string };
    } else {
      const first = pk(FIRST), last = pk(LAST);
      const name = `${first} ${last}`;
      const status = wt([["Lead", 0.17], ["Consult booked", 0.08], ["Active", 0.52], ["On hold", 0.07], ["Closed", 0.16]]);
      const owner = pk(TEAM);
      const fit = R() < 0.15 ? null : 1 + ri(5);
      const since = addDays("2024-01-08", ri(1020));
      const source = pk(["Referral", "Website", "Event", "Partner"]);
      // the draws the table does not show still advance the generator, in the prototype's order, so every later row matches
      R(); // key
      if (R() < 0.3) pk(TEAM); // refby
      pk(["Mornings", "Afternoons", "Evenings"]); // pref
      R(); // email
      if (R() < 0.9) { ri(780); ri(100); ri(100); } // phone
      if (R() < 0.72) { ri(48); ri(12); ri(28); } // dob
      if (R() < 0.7) { ri(990); pk(STREETS); pk(CITIES); } // addr
      if (R() < 0.65) ri(400); // idDoc
      if (R() < 0.8) hex(); // taxId
      if (R() < 0.35) pk(NEXTS); // summary
      r = { name, status, owner, fit, since, source };
    }
    const id = `c${i}`;
    const h = protoHash(`${id}a`);
    const c1 = pickChannel((h % 1000) / 1000);
    const u2 = (protoHash(`${id}b`) % 1000) / 1000;
    const c2 = protoHash(`${id}c`) % 100 < 55 ? c1 : pickChannel(u2);
    out.push({ id, ...r, fch: i === 0 ? "Referral" : c1, lch: i === 0 ? "Email" : c2 });
  }
  // projects, invoices, meetings and tasks come from the same generator, after the clients, so they are drawn here with the same R
  const KINDS = strs(PROTO_KINDS), TASKT = strs(PROTO_TASKT), AGS = strs(PROTO_AGS);
  const argl = (list: readonly unknown[]): unknown[][] => list as unknown[][];
  const projects: ProtoProject[] = [];
  const hp = argl(PROTO_HP);
  for (let i = 0; i < 380; i++) {
    let r: Omit<ProtoProject, "id">;
    if (i < hp.length) { const a = hp[i] as [string, string, string, string, string, string, number, string[]]; r = { title: a[0], client: a[1], stage: a[2], lead: a[3], start: a[4], due: a[5], budget: a[6], tags: a[7] }; }
    else {
      const c = out[6 + ri(1234)] as ProtoClient, last = c.name.split(" ").pop() as string, st = addDays("2026-06-15", ri(190));
      const title = `${last} ${pk(KINDS)}`;
      const stage = wt([["Intake", 0.18], ["Drafting", 0.3], ["In review", 0.17], ["Delivered", 0.28], ["On hold", 0.07]]);
      const lead = pk(TEAM), due = addDays(st, 21 + ri(70)), budget = 250 * (8 + ri(88));
      const tags = R() < 0.4 ? [] : [pk(["Priority", "Fixed fee", "Hourly", "Rush", "Referral"])];
      r = { title, client: c.id, stage, lead, start: st, due, budget, tags };
    }
    projects.push({ id: `p${i}`, ...r });
  }
  const invoices: ProtoInvoice[] = [];
  const addInv = (r: Omit<ProtoInvoice, "id" | "no">): void => { invoices.push({ id: `i${invoices.length}`, no: `INV-${2038 + invoices.length}`, ...r }); };
  for (const a of argl(PROTO_HI) as [string, string | null, number, string, string, string, string][]) addInv({ client: a[0], project: a[1] || null, amount: a[2], status: a[3], issued: a[4], due: a[5], method: a[6] });
  const stOf = (due: string): string => (due < PROTO_TODAY ? wt([["Paid", 0.85], ["Overdue", 0.15]]) : wt([["Paid", 0.5], ["Sent", 0.42], ["Draft", 0.08]]));
  while (invoices.length < 2120) {
    const p = projects[5 + ri(375)] as ProtoProject, useP = R() < 0.6, cl = useP ? p.client : (out[6 + ri(1234)] as ProtoClient).id;
    const issued = addDays("2025-11-03", ri(355)), due = addDays(issued, pk([14, 14, 30]));
    addInv({ client: cl, project: useP ? p.id : null, amount: 50 * (4 + ri(116)), status: stOf(due), issued, due, method: pk(["Card", "Bank", "Bank", "Cheque"]) });
  }
  const meetings: ProtoMeeting[] = [];
  const addMeet = (title: string, when: string, client: string, host: string, kind: string, notes: string): void => { meetings.push({ id: `m${meetings.length}`, title, when, client, host, kind, done: when < PROTO_NOW, notes }); };
  for (const a of argl(PROTO_HM) as [string, string, string, string, string, string?][]) addMeet(a[0], a[1], a[2], a[3], a[4], a[5] ?? "");
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  while (meetings.length < 650) {
    const c = out[6 + ri(1234)] as ProtoClient, d = addDays(PROTO_TODAY, ri(150) - 90), when = `${d}T${pad2(9 + ri(8))}:${pk(["00", "30"])}`, kind = pk(["Consult", "Check-in", "Check-in", "Review", "Signing"]);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    addMeet(`${kind} · ${c.name}`, when, c.id, pk(TEAM), kind, "");
  }
  const tasks: ProtoTask[] = [];
  const addTask = (title: string, project: string, assignee: string, status: string, due: string): void => { tasks.push({ id: `t${tasks.length}`, title, project, assignee, status, due, done: status === "Done" }); };
  for (const a of argl(PROTO_HT) as [string, string, string, string, string][]) addTask(a[0], a[1], a[2], a[3], a[4]);
  while (tasks.length < 920) {
    const p = projects[5 + ri(375)] as ProtoProject, status = wt([["To do", 0.3], ["Doing", 0.22], ["Blocked", 0.05], ["Done", 0.43]]);
    addTask(pk(TASKT), p.id, R() < 0.35 ? pk(AGS) : pk(TEAM), status, addDays(p.start, ri(60)));
  }
  cachedWork = { projects, invoices, meetings, tasks };
  // the prototype's Records place renames the drawn "Oscar Pruitt" (else row 7) to the Pruitt client the other places talk about
  const pruitt = out.find((c) => c.name === "Oscar Pruitt") ?? (out[6] as ProtoClient);
  pruitt.name = "Marcus Pruitt";
  cached = out;
  return out;
}

/** The projects, invoices, meetings and tasks of the prototype's Northwind Space, in its order. */
export function protoWork(): ProtoWork {
  protoClients();
  return cachedWork as ProtoWork;
}
