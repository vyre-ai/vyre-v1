// The Northwind Space of the approved Knowledge mockup, as rows the screens read: pages (Ian Brooks, Elena Rivera, Maya Chen, Brooks onboarding, Client update cadence, the agents), their facts with
// source, who wrote them and history, Notes with [[links]], the trail, an upkeep question (two addresses for Ian), Trash and Archive, and a graph with labelled edges and the quote behind each. A fake
// replica holds one state table; every read the Knowledge screens make has a resolver that honours its inputs, and the writes (undo, restore, correct, question, notes, page delete, remember,
// forget, accept, reject) change the rows the way the real ones do and put a line on the trail. Tests and screenshots use this; nothing else does.
import { createFakeReplica, liveQuery } from "../../../../../../client/src/index.ts";
import type { LiveQuery, Row } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { LiveCap, MemoryData } from "./data.tsx";
import type { KFact, PageKind, PageRow, Question, TrailRow } from "./know.ts";
import type { GEdge, GNode } from "./model.ts";
import type { SampleMemory } from "./sample.ts";

const T = (d: number, h: number, m = 0): number => Date.UTC(2025, 9, d, h, m);
export const KNOW_NOW = T(24, 9, 52);
const DAY = 86_400_000;
export const KEEP_DAYS = 60;

export const ME = "usr_irfad";
export const PEOPLE: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad", usr_lena: "Lena Ortiz", usr_sam: "Sam Patel", upkeep: "Upkeep" };
export const AGENTS: Record<string, string> = { agt_assistant: "Assistant", agt_intake: "Intake", agt_billing: "Billing", agt_docs: "Docs", agt_research: "Research", agt_scout: "Scout" };
const NAMES: Record<string, string> = { ...PEOPLE, ...AGENTS };
const idOfName = (n: string): string => Object.entries(NAMES).find(([, v]) => v === n)?.[0] ?? n;

export interface PageExtra { subtitle?: string; blurb?: string; visibleTo?: string; alias?: string[] }
export type KPage = PageRow & PageExtra;

interface Subject { id: string; name: string; type: PageKind | "chat" | "run"; layer: KFact["layer"]; blurb: string; born: number; org?: string; alias?: string[]; vis: string }
const VIS: Record<KFact["layer"], string> = { space: "Everyone in Northwind", project: "People on this project", person: "Only you", agent: "This agent and admins" };
const S = (id: string, name: string, type: Subject["type"], layer: KFact["layer"], blurb: string, bornDay: number, o: { org?: string; alias?: string[] } = {}): Subject =>
  ({ id, name, type, layer, blurb, born: T(bornDay, 9), vis: VIS[layer], ...o });

export const SUBJECTS: Subject[] = [
  S("ian", "Ian Brooks", "client", "space", "Client contact at Brooks Logistics. Signed on Sep 3, Growth plan.", 3, { alias: ["Ian"], org: "Brooks Logistics" }),
  S("elena", "Elena Rivera", "client", "project", "Referred by Maya. Consult booked, intake form out.", 23, { alias: ["Elena", "Ms. Rivera"], org: "Rivera Holdings" }),
  S("priya", "Priya Nair", "client", "space", "Studio owner, referred by Maya in September.", 9, { alias: ["Priya"], org: "Nair Studio" }),
  S("maya", "Maya Chen", "person", "space", "Admin. Leads consults and the Brooks onboarding.", 1, { alias: ["Maya"] }),
  S("omar", "Omar Haddad", "person", "space", "Operations. Owns the intake form and the #intake channel.", 1, { alias: ["Omar"] }),
  S("lena", "Lena Ortiz", "person", "space", "Handles county records and conflict checks.", 1, { alias: ["Lena"] }),
  S("sam", "Sam Patel", "person", "space", "Billing. Owns the Q4 invoice batch.", 1, { alias: ["Sam"] }),
  S("brooksonb", "Brooks onboarding", "project", "project", "Kickoff held Oct 12. Weekly updates start this Friday.", 12),
  S("rivera", "Rivera matter", "project", "project", "New engagement for Elena Rivera, led by Maya.", 23),
  S("q4", "Q4 billing", "project", "project", "October close and the invoice batch.", 20),
  S("pricing", "Pricing research", "project", "project", "Nearby firms and what they charge for a first consult.", 8),
  S("cadence", "Client update cadence", "topic", "space", "When and how clients hear from us.", 14),
  S("fee", "Consult fee", "topic", "space", "What a first consult costs and when it is waived.", 1),
  S("referral", "Referral rules", "topic", "space", "How partner referrals are treated.", 20),
  S("hours", "Office hours", "topic", "space", "When the office is open.", 1),
  S("ag-assistant", "Assistant", "agent", "space", "Your general agent. Drafts updates and keeps notes.", 1),
  S("ag-intake", "Intake", "agent", "agent", "Books first calls and gathers client details.", 1),
  S("ag-billing", "Billing", "agent", "agent", "Invoices and reminders.", 1),
  S("ag-research", "Research", "agent", "agent", "Market and competitor research.", 1),
  S("rec-brooks", "Brooks Logistics", "record", "space", "Client record: plan, contacts, invoices.", 3),
  S("chat-k1", "Brooks kickoff", "chat", "project", "Chat with Intake on Oct 12.", 12),
  S("chat-k2", "Brooks weekly update", "chat", "project", "Chat with Assistant, today.", 24),
  S("chat-c1", "Rivera intake", "chat", "project", "Chat with Intake.", 24),
  S("chat-c2", "Competitor pricing", "chat", "project", "Chat with Research.", 23),
];
const sub = (id: string): Subject => SUBJECTS.find((s) => s.id === id)!;
export const pageIdOf = (subjectId: string): string => `pg_${subjectId}`;
const PAGEABLE = new Set<Subject["type"]>(["person", "client", "project", "topic", "agent"]);

/** The chat a source chip points to: the thread id and the message in it. */
const CHAT: Record<string, { thread: string; title: string }> = { k1: { thread: "thr_k1", title: "Brooks kickoff" }, k2: { thread: "thr_k2", title: "Brooks weekly update" }, c1: { thread: "thr_c1", title: "Rivera intake" }, c2: { thread: "thr_c2", title: "Competitor pricing" }, c3: { thread: "thr_c3", title: "October invoices" }, c6: { thread: "thr_c6", title: "County records search" } };

interface Src { k: KFact["sourceKind"]; label: string; chat?: string; i?: number; who: string }
let Q = 0;
const F = (s: string, text: string, layer: KFact["layer"], at: number, src: Src, by: string, o: Partial<KFact> & { gone?: number; why?: string; versions?: number; history?: Array<{ at: number; by: string; text: string }> } = {}): KFact & { _s: string; _who: string; _history: Array<{ at: number; by: string; text: string }> } => {
  const { gone, why, history, ...rest } = o;
  const link = src.chat ? `vyre://thread/${CHAT[src.chat]!.thread}?m=msg_${src.chat}_${src.i ?? 0}` : undefined;
  const subj = sub(s);
  const f: KFact & { _s: string; _who: string; _history: Array<{ at: number; by: string; text: string }> } = {
    factId: `fct_m${++Q}`, layer, ownerRef: layer === "person" ? ME : layer === "space" ? "spc_northwind" : layer === "agent" ? idOfName(by) : `prj_${s}`, ...(layer === "agent" ? { agentId: idOfName(by) } : {}),
    text, validFrom: at, learnedAt: at, sourceKind: src.k, sourceRef: src.chat ? `msg_${src.chat}_${src.i ?? 0}` : `src_${src.label}`, ...(link ? { sourceLink: link } : {}), status: "current",
    subject: { pageId: pageIdOf(s), title: subj.name, kind: subj.type as PageKind }, sourceTitle: src.label, by: idOfName(by), byKind: by === "Upkeep" ? "upkeep" : NAMES[idOfName(by)] && idOfName(by).startsWith("agt_") ? "agent" : "person",
    versions: (history?.length ?? 0) + 1, ...rest, _s: s, _who: idOfName(src.who), _history: history ?? [],
  };
  if (gone !== undefined) { f.status = "removed"; f.trashedAt = KNOW_NOW - gone * DAY; f.trashReason = why ?? "removed"; if (gone > KEEP_DAYS) { f.archivedAt = f.trashedAt + KEEP_DAYS * DAY; } }
  return f;
};

const SEED_FACTS = [
  F("ian", "Prefers updates on Fridays.", "space", T(24, 9, 38), { k: "chat", label: "Brooks weekly update", chat: "k2", i: 2, who: "Irfad Imtiaz" }, "Assistant"),
  F("ian", "Reads updates on his phone: three bullets, no attachments, nothing before 9 am.", "space", T(12, 15, 5), { k: "chat", label: "Brooks kickoff", chat: "k1", i: 2, who: "Irfad Imtiaz" }, "Intake"),
  F("ian", "Brooks Logistics is on the Growth plan, $2,400 a month, since Sep 3.", "space", T(4, 11, 0), { k: "record", label: "Brooks Logistics", who: "Billing" }, "Billing", { history: [{ at: T(3, 10, 0), by: "Sam Patel", text: "Brooks Logistics is on the Starter plan, $1,400 a month." }] }),
  F("ian", "Works in Central European time, so Pacific mornings reach him in the afternoon.", "space", T(12, 15, 8), { k: "chat", label: "Brooks kickoff", chat: "k1", i: 1, who: "Intake" }, "Intake"),
  F("ian", "Send updates to ian@brooks-logistics.example.", "space", T(12, 15, 9), { k: "chat", label: "Brooks kickoff", chat: "k1", i: 1, who: "Intake" }, "Intake"),
  F("ian", "Send updates to ops@brooks-logistics.example.", "space", T(22, 16, 20), { k: "channel", label: "#brooks", who: "Omar Haddad" }, "Assistant"),
  F("maya", "Leads consults, Tuesday to Thursday.", "space", T(12, 16, 10), { k: "channel", label: "#intake", who: "Omar Haddad" }, "Intake"),
  F("maya", "Prefers email over calls.", "space", T(12, 16, 12), { k: "chat", label: "Rivera intake", chat: "c1", i: 0, who: "Maya Chen" }, "Intake"),
  F("maya", "Leads the Brooks onboarding.", "project", T(12, 15, 20), { k: "chat", label: "Brooks kickoff", chat: "k1", i: 0, who: "Irfad Imtiaz" }, "Intake"),
  F("omar", "Wants new-client alerts at 7 am.", "agent", T(14, 7, 0), { k: "chat", label: "Direct chat with Intake", chat: "c1", i: 0, who: "Omar Haddad" }, "Intake"),
  F("omar", "Owns the client intake form.", "space", T(15, 11, 30), { k: "channel", label: "#intake", who: "Lena Ortiz" }, "Intake"),
  F("lena", "Handles county records and conflict checks.", "space", T(24, 9, 40), { k: "chat", label: "County records search", chat: "c6", i: 0, who: "Lena Ortiz" }, "Scout"),
  F("elena", "Referred by Maya Chen.", "project", T(23, 9, 25), { k: "chat", label: "Rivera intake", chat: "c1", i: 0, who: "Maya Chen" }, "Intake"),
  F("elena", "Consult booked Tuesday at 2:00 pm with Maya.", "project", T(24, 9, 31), { k: "chat", label: "Rivera intake", chat: "c1", i: 2, who: "Omar Haddad" }, "Intake"),
  F("elena", "Prefers afternoons.", "project", T(23, 9, 25), { k: "chat", label: "Rivera intake", chat: "c1", i: 0, who: "Maya Chen" }, "Intake"),
  F("fee", "The standard consult fee is $250.", "space", T(8, 14, 2), { k: "chat", label: "Competitor pricing", chat: "c2", i: 0, who: "Irfad Imtiaz" }, "Research", { history: [{ at: T(3, 10, 0), by: "Research", text: "The standard consult fee is $200." }] }),
  F("referral", "Referrals from partner firms get the first consult free.", "space", T(20, 16, 40), { k: "chat", label: "Rivera intake", chat: "c1", i: 0, who: "Irfad Imtiaz" }, "Intake"),
  F("referral", "The Rivera letter waives the consult fee.", "project", T(24, 8, 50), { k: "chat", label: "Rivera intake", chat: "c1", i: 1, who: "Maya Chen" }, "Docs"),
  F("hours", "Office hours are 9 to 5 Pacific.", "space", T(2, 9, 0), { k: "record", label: "Space settings", who: "Irfad Imtiaz" }, "Assistant"),
  F("cadence", "Client updates go out on Fridays by noon unless the client asks otherwise.", "space", T(14, 10, 0), { k: "channel", label: "#intake", who: "Maya Chen" }, "Assistant"),
  F("brooksonb", "Kickoff held Oct 12. The first weekly update goes out on a Friday.", "project", T(12, 15, 30), { k: "chat", label: "Brooks kickoff", chat: "k1", i: 1, who: "Intake" }, "Intake"),
  F("brooksonb", "First deliverable is the logistics dashboard, due Nov 14.", "project", T(12, 15, 34), { k: "chat", label: "Brooks kickoff", chat: "k1", i: 1, who: "Intake" }, "Intake"),
  F("q4", "October invoices total $18,420 across 12 drafts.", "project", T(23, 17, 0), { k: "run", label: "Invoice batch", who: "Billing" }, "Billing"),
  F("q4", "Hold the Okafor invoice until the purchase order is checked.", "project", T(23, 16, 55), { k: "chat", label: "October invoices", chat: "c3", i: 0, who: "Sam Patel" }, "Billing"),
  F("pricing", "Harlow & Price charges $300 for a consult.", "project", T(9, 15, 15), { k: "chat", label: "Competitor pricing", chat: "c2", i: 2, who: "Sam Patel" }, "Research"),
  F("ag-intake", "Send the intake form within 5 minutes of a booking.", "agent", T(22, 17, 10), { k: "chat", label: "Rivera intake", chat: "c1", i: 1, who: "Irfad Imtiaz" }, "Intake", { history: [{ at: T(20, 11, 0), by: "Intake", text: "Send the intake form within 10 minutes of a booking." }] }),
  F("priya", "Prefers a call before any invoice is sent.", "space", T(15, 14, 20), { k: "chat", label: "October invoices", chat: "c3", i: 0, who: "Sam Patel" }, "Billing"),
  // Trash and Archive
  F("fee", "The standard consult fee is $200.", "space", T(3, 10, 0), { k: "chat", label: "Competitor pricing", chat: "c2", i: 0, who: "Research" }, "Research", { gone: 16, why: "Replaced by a newer fact" }),
  F("pricing", "Ortega Partners charges $250.", "project", T(9, 15, 18), { k: "chat", label: "Competitor pricing", chat: "c2", i: 2, who: "Sam Patel" }, "Research", { gone: 8, why: "Corrected to $200" }),
  F("maya", "Prefers meetings before 10 am.", "space", T(5, 9, 0), { k: "chat", label: "Direct chat with Intake", chat: "c1", i: 0, who: "Maya Chen" }, "Intake", { gone: 3, why: "She said it is out of date" }),
  F("ian", "Prefers phone calls on Mondays.", "space", T(-26, 10, 0), { k: "record", label: "Brooks Logistics", who: "Sam Patel" }, "Billing", { gone: 47, why: "Contradicted by two newer facts" }),
  F("pricing", "Meyer Law charged $225 before the July change.", "project", T(-70, 9, 0), { k: "chat", label: "Competitor pricing", chat: "c2", i: 2, who: "Sam Patel" }, "Research", { gone: 71, why: "Untouched in Trash for 60 days" }),
  F("hours", "The office was closed Jul 3 to Jul 6.", "space", T(-95, 9, 0), { k: "record", label: "Space settings", who: "Irfad Imtiaz" }, "Assistant", { gone: 112, why: "Untouched in Trash for 60 days" }),
];
export const FACT_IDS = Object.fromEntries(SEED_FACTS.map((f) => [`${f.subject!.title}: ${f.text}`, f.factId]));
const factIdOf = (s: string, text: string): string => SEED_FACTS.find((f) => f._s === s && f.text === text)!.factId;

const NOTES: Record<string, { text: string; by: string; at: number }> = {
  ian: { text: "Ian is the sponsor on the logistics dashboard. He wants a short Friday note from [[Brooks onboarding]], written by the [[Assistant]]. The house rule is in [[Client update cadence]].", by: "agt_assistant", at: T(22, 9) },
  cadence: { text: "Maya set this rule in #intake. It applies to every client unless the client asks otherwise.", by: "usr_maya", at: T(14, 10) },
  elena: { text: "Referral from Maya. Fee waived, see [[Referral rules]].", by: "agt_intake", at: T(24, 9) },
};

// edges of the graph: [from, to, label, the words that name it, the title of where they were said, chat key, message index, day it appeared]
const EDGES: Array<[string, string, string, string, string, string | null, number, number]> = [
  ["ian", "brooksonb", "client in", "Brooks Logistics signed on Sep 3. Kickoff for the onboarding is Thursday.", "Brooks kickoff", "k1", 0, 12],
  ["ian", "cadence", "prefers", "Ian told me today he prefers updates on Fridays.", "Brooks weekly update", "k2", 2, 24],
  ["chat-k1", "ian", "about", "Ian was clear about updates. He reads everything on his phone, so three bullets, no attachments, and nothing before 9 in the morning.", "Brooks kickoff", "k1", 2, 12],
  ["chat-k2", "ian", "about", "Ian told me today he prefers updates on Fridays. Hold it until then.", "Brooks weekly update", "k2", 2, 24],
  ["ian", "rec-brooks", "has record", "Client record created from the signed order form.", "Brooks Logistics", null, -1, 3],
  ["maya", "brooksonb", "leads", "Maya runs the Brooks onboarding and sits in the kickoff.", "Brooks kickoff", "k1", 0, 12],
  ["omar", "ian", "sends updates to", "Omar sent the Oct 22 note to ops@brooks-logistics.example.", "#brooks", null, -1, 22],
  ["ag-assistant", "brooksonb", "drafts updates for", "Here is the update for Ian Brooks. It is three bullets and no attachment.", "Brooks weekly update", "k2", 1, 24],
  ["ag-assistant", "chat-k2", "wrote in", "Held. It will go out Friday at 9:00 his time.", "Brooks weekly update", "k2", 3, 24],
  ["ag-intake", "chat-k1", "ran", "Kickoff booked for Thursday 11:00. I sent Ian the welcome note.", "Brooks kickoff", "k1", 1, 12],
  ["chat-k1", "brooksonb", "kickoff for", "Kickoff booked for Thursday 11:00.", "Brooks kickoff", "k1", 1, 12],
  ["cadence", "brooksonb", "applies to", "Client updates go out on Fridays by noon unless the client asks otherwise.", "#intake", null, -1, 14],
  ["maya", "cadence", "set", "Maya set the Friday rule in #intake.", "#intake", null, -1, 14],
  ["elena", "rivera", "client in", "New client: Elena Rivera, referred by Maya.", "Rivera intake", "c1", 0, 23],
  ["maya", "rivera", "leads", "Booked Tuesday at 2:00 with Maya.", "Rivera intake", "c1", 2, 23],
  ["chat-c1", "elena", "about", "New client: Elena Rivera, referred by Maya.", "Rivera intake", "c1", 0, 24],
  ["referral", "rivera", "waives fee for", "The Rivera letter waives the consult fee.", "Rivera intake", "c1", 1, 24],
  ["referral", "fee", "overrides", "Referrals from partner firms get the first consult free.", "Rivera intake", "c1", 0, 20],
  ["fee", "chat-c2", "discussed in", "The median consult is $250; three firms offer a free first one.", "Competitor pricing", "c2", 3, 8],
  ["ag-research", "pricing", "works on", "Compare our consult pricing with firms within 20 miles.", "Competitor pricing", "c2", 0, 8],
  ["pricing", "fee", "informs", "Ours sits at the median.", "Competitor pricing", "c2", 3, 9],
  ["sam", "q4", "owns", "Sam owns the October batch.", "October invoices", "c3", 0, 20],
  ["ag-billing", "q4", "works on", "October is reconciled. 12 invoices are ready.", "October invoices", "c3", 0, 23],
  ["hours", "ag-intake", "used by", "Office hours decide when Intake offers consult slots.", "Space settings", null, -1, 2],
  ["lena", "rivera", "records for", "Lena runs the county records search for the Rivera matter.", "County records search", "c6", 0, 24],
  ["priya", "maya", "referred by", "Priya came to us through Maya.", "Direct chat with Maya", null, -1, 9],
];
const nodeIdOf = (id: string): string => (PAGEABLE.has(sub(id).type) ? pageIdOf(id) : id);
export type KEdge = GEdge & { source?: { title: string; link?: string; kind: "chat" | "channel" | "record" } };
export type KNode = GNode & { pageId?: string };

const TRAIL_SEED: Array<[number, string, TrailRow["action"], string, string, string?]> = [
  [T(24, 9, 38), "agt_assistant", "learn", "Ian Brooks: Prefers updates on Fridays.", "From you in Brooks weekly update", factIdOf("ian", "Prefers updates on Fridays.")],
  [T(24, 9, 31), "agt_intake", "learn", "Elena Rivera: Consult booked Tuesday at 2:00 pm with Maya.", "From Omar Haddad in Rivera intake", factIdOf("elena", "Consult booked Tuesday at 2:00 pm with Maya.")],
  [T(23, 2, 0), "upkeep", "merge", "Office hours: two copies of “Office hours are 9 to 5 Pacific.”", "Same words, same source", factIdOf("hours", "Office hours are 9 to 5 Pacific.")],
  [T(8, 14, 3), "upkeep", "delete", "Consult fee: “The standard consult fee is $200.”", "Replaced by $250"],
  [T(22, 17, 10), ME, "edit", "Intake: form within 5 minutes (was 10)", "You tightened the rule", factIdOf("ag-intake", "Send the intake form within 5 minutes of a booking.")],
  [T(22, 16, 20), "agt_assistant", "learn", "Ian Brooks: Send updates to ops@brooks-logistics.example.", "From Omar Haddad in #brooks", factIdOf("ian", "Send updates to ops@brooks-logistics.example.")],
  [T(22, 2, 0), "upkeep", "flag", "Ian Brooks: two addresses for updates", "Asked a person which is right", factIdOf("ian", "Send updates to ian@brooks-logistics.example.")],
  [T(16, 10, 5), ME, "delete", "Pricing research: “Ortega Partners charges $250.”", "Corrected to $200"],
  [T(21, 11, 0), "usr_maya", "delete", "Maya Chen: “Prefers meetings before 10 am.”", "Out of date, she said"],
  [T(14, 10, 0), "agt_assistant", "learn", "Client update cadence: Fridays by noon", "From Maya Chen in #intake", factIdOf("cadence", "Client updates go out on Fridays by noon unless the client asks otherwise.")],
  [T(12, 15, 5), "agt_intake", "learn", "Ian Brooks: three bullets, no attachments, nothing before 9 am", "From you in Brooks kickoff", factIdOf("ian", "Reads updates on his phone: three bullets, no attachments, nothing before 9 am.")],
  [T(8, 14, 2), ME, "edit", "Consult fee: $250 (was $200)", "You corrected it in the pricing review", factIdOf("fee", "The standard consult fee is $250.")],
  [T(4, 11, 0), "agt_billing", "learn", "Ian Brooks: Growth plan, $2,400 a month", "From the Brooks Logistics record", factIdOf("ian", "Brooks Logistics is on the Growth plan, $2,400 a month, since Sep 3.")],
];

interface State {
  facts: Array<KFact & { _s: string; _who: string; _history: Array<{ at: number; by: string; text: string }> }>;
  pages: KPage[];
  notes: Record<string, { text: string; by: string; at: number; version: number; versions: Array<{ version: number; by: string; at: number; notes: string }> }>;
  trail: TrailRow[];
  questions: Question[];
  trashedPages: string[];
  keep: number;
  seq: number;
}

function seed(): State {
  const pages: KPage[] = SUBJECTS.filter((s) => PAGEABLE.has(s.type)).map((s) => ({
    pageId: pageIdOf(s.id), title: s.name, kind: s.type as PageKind, layer: s.layer, ownerRef: s.layer === "space" ? "spc_northwind" : s.layer === "agent" ? idOfName(s.name) : `prj_${s.id}`,
    ...(s.layer === "agent" ? { agentId: idOfName(s.name) } : {}), version: 1, createdAt: s.born, updatedAt: s.born,
    subtitle: s.type === "client" ? `Client${s.org ? ` at ${s.org}` : ""}` : s.type === "person" ? "Person" : s.type === "project" ? "Project" : s.type === "topic" ? "Topic" : "Agent", blurb: s.blurb, visibleTo: s.vis, alias: s.alias ?? [],
  }));
  const notes: State["notes"] = {};
  for (const [sid, n] of Object.entries(NOTES)) {
    const pid = pageIdOf(sid);
    notes[pid] = { ...n, version: 1, versions: [{ version: 1, by: n.by, at: n.at, notes: n.text }] };
    const pg = pages.find((p) => p.pageId === pid)!;
    pg.updatedAt = n.at;
  }
  let tn = 0;
  const trail: TrailRow[] = TRAIL_SEED.map(([at, actor, action, text, reason, factId]) => ({
    id: `trl_${++tn}`, at, action, actor, actorKind: actor === "upkeep" ? "upkeep" : actor.startsWith("agt_") ? "agent" : "person", ...(factId ? { factId } : {}), reason, detail: { text },
  } as TrailRow));
  const aId = factIdOf("ian", "Send updates to ian@brooks-logistics.example."), bId = factIdOf("ian", "Send updates to ops@brooks-logistics.example.");
  const questions: Question[] = [{
    questionId: "qst_ian_address", kind: "contradiction", status: "open", createdAt: T(22, 2, 0), layer: "space",
    facts: [SEED_FACTS.find((f) => f.factId === aId)!, SEED_FACTS.find((f) => f.factId === bId)!].map(strip),
  }];
  return { facts: SEED_FACTS.map((f) => structuredClone(f)), pages, notes, trail, questions, trashedPages: [], keep: KEEP_DAYS, seq: 100 };
}

const strip = (f: KFact & { _s?: string; _who?: string; _history?: unknown }): KFact => { const { _s: _a, _who: _b, _history: _c, ...rest } = f; return rest; };

export interface KnowSampleOptions { now?: number; fail?: string; member?: boolean; proposed?: boolean }
export interface KnowSample extends SampleMemory { snapshot(): State }

export function createKnowSample(o: KnowSampleOptions = {}): KnowSample {
  const now = o.now ?? KNOW_NOW;
  const replica = createFakeReplica(`know-${Math.random().toString(36).slice(2)}`);
  const calls: SampleMemory["calls"] = [];
  const opened: string[] = [];
  const initial = seed();
  if (o.proposed) {
    initial.facts.push(F("elena", "Elena wants the engagement letter as a PDF.", "project", T(24, 9, 45), { k: "chat", label: "Rivera intake", chat: "c1", i: 3, who: "Maya Chen" }, "Intake", { status: "proposed" } as never) as never);
  }
  replica.put("state", [{ id: "s", ...initial } as unknown as Row]);
  const st = (): State => (replica.rows("state")[0] as unknown as State);
  const save = (s: State): void => replica.put("state", [{ id: "s", ...s } as unknown as Row]);
  const live = (s: State): KFact[] => s.facts.filter((f) => f.status === "current" && !f.trashedAt);
  const nameOf = (id: string): string => NAMES[id] ?? id;
  const log = (s: State, action: TrailRow["action"], actor: string, text: string, reason: string, factId?: string, pageId?: string): void => {
    s.trail.unshift({ id: `trl_${++s.seq}`, at: now, action, actor, actorKind: actor === "upkeep" ? "upkeep" : actor.startsWith("agt_") ? "agent" : "person", ...(factId ? { factId } : {}), ...(pageId ? { pageId } : {}), reason, detail: { text } } as TrailRow);
  };
  const find = (s: State, id: string): State["facts"][number] => { const f = s.facts.find((x) => x.factId === id); if (!f) throw new Error("fact not found"); return f; };
  const label = (f: KFact): string => `${f.subject?.title ?? "A page"}: ${f.text}`;
  const archived = (f: KFact, s: State): boolean => f.trashedAt !== undefined && now - f.trashedAt > s.keep * DAY;

  // ------------------------------------------------------------ reads
  replica.resolve("memory.learned", (_t, i: CapMap["memory.learned"]["in"]) => {
    const s = st();
    const items = live(s).filter((f) => (!i.since || f.learnedAt >= i.since) && (!i.layer || f.layer === i.layer) && (!i.agentId || f.agentId === i.agentId)).map((f) => ({
      fact: f, at: f.learnedAt, actor: f.by ?? "", actorKind: f.byKind ?? "agent", sourceKind: f.sourceKind, sourceRef: f.sourceRef, ...(f.sourceLink ? { sourceLink: f.sourceLink } : {}), from: s.facts.find((x) => x.factId === f.factId)!._who, undone: false,
    }));
    for (const r of s.trail.filter((x) => x.actorKind === "upkeep" && (x.action === "merge" || x.action === "flag") && x.factId && (!i.since || x.at >= i.since))) {
      const f = s.facts.find((x) => x.factId === r.factId);
      if (f) items.push({ fact: { ...f, ...(r.reason ? { trashReason: r.reason } : {}) }, at: r.at, actor: "upkeep", actorKind: "upkeep", sourceKind: f.sourceKind, sourceRef: f.sourceRef, from: r.action, undone: false } as never);
    }
    items.sort((a, b) => b.at - a.at);
    return { items: items.slice(0, i.limit ?? 200).map((x) => ({ ...x, fact: strip(x.fact as never) })), total: items.length };
  });

  const pageRows = (s: State): KPage[] => s.pages.filter((p) => !s.trashedPages.includes(p.pageId));
  replica.resolve("memory.page.list", (_t, i: CapMap["memory.page.list"]["in"]) => {
    const s = st();
    const q = (i.q ?? "").toLowerCase();
    const list = pageRows(s).filter((p) => (!i.kind || p.kind === i.kind) && (!i.layer || p.layer === i.layer) && (q === "" || p.title.toLowerCase().includes(q) || (p.alias ?? []).some((a) => q.includes(a.toLowerCase()))));
    return { pages: list, total: list.length };
  });
  const backlinksOf = (s: State, pid: string): CapMap["memory.backlinks"]["out"]["backlinks"] => {
    const sid = SUBJECTS.find((x) => pageIdOf(x.id) === pid)?.id;
    if (!sid) return [];
    const out: CapMap["memory.backlinks"]["out"]["backlinks"] = [];
    for (const [a, b, lab, quote, title, chat, , day] of EDGES) {
      if (a !== sid && b !== sid) continue;
      const o2 = sub(a === sid ? b : a);
      if (!["chat", "run", "record"].includes(o2.type)) continue;
      out.push({ kind: o2.type === "chat" ? "chat" : o2.type === "record" ? "record" : "run", ref: o2.id, title: o2.name, quote, ...(chat ? { link: `vyre://thread/${CHAT[chat]!.thread}?m=msg_${chat}_0` } : {}), at: T(day, 9), label: lab });
    }
    for (const f of live(s).filter((x) => x._s === sid)) {
      if (out.some((b) => b.title === f.sourceTitle)) continue;
      out.push({ kind: f.sourceKind === "record" ? "record" : f.sourceKind === "run" ? "run" : "chat", ref: f.sourceRef, title: f.sourceTitle ?? "", quote: f.text, ...(f.sourceLink ? { link: f.sourceLink } : {}), at: f.learnedAt });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 6);
  };
  replica.resolve("memory.page.get", (_t, i: CapMap["memory.page.get"]["in"]) => {
    const s = st();
    const page = s.pages.find((p) => p.pageId === i.pageId || (i.title && p.title.toLowerCase() === i.title.toLowerCase()));
    if (!page) throw new Error("validation.not_found");
    const sid = page.pageId.slice(3);
    const n = s.notes[page.pageId];
    const links = n ? [...n.text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => ({ label: "links to", title: m[1]!, pageId: s.pages.find((p) => p.title.toLowerCase() === m[1]!.toLowerCase())?.pageId, evidence: n.text })) : [];
    return { page, notes: n?.text ?? "", facts: live(s).filter((f) => f._s === sid).map(strip), links, backlinks: backlinksOf(s, page.pageId), versions: n?.version ?? 1 } as never;
  });
  replica.resolve("memory.backlinks", (_t, i: CapMap["memory.backlinks"]["in"]) => ({ backlinks: backlinksOf(st(), i.pageId) }));
  replica.resolve("memory.page.versions", (_t, i: CapMap["memory.page.versions"]["in"]) => ({ versions: [...(st().notes[i.pageId]?.versions ?? [])].reverse().map((v) => ({ version: v.version, by: v.by, actorKind: v.by.startsWith("agt_") ? "agent" as const : "person" as const, at: v.at, notes: v.notes })) }));
  replica.resolve("memory.fact.get", (_t, i: CapMap["memory.fact.get"]["in"]) => {
    const f = find(st(), i.factId);
    return { fact: strip(f), history: f._history.map((h, k) => ({ ...strip(f), factId: `${f.factId}_v${k}`, text: h.text, learnedAt: h.at, validFrom: h.at, closedAt: f.learnedAt, status: "closed" as const, by: idOfName(h.by) })) };
  });
  replica.resolve("memory.trail", (_t, i: CapMap["memory.trail"]["in"]) => {
    const s = st();
    const rows = s.trail.filter((r) => (!i.factId || r.factId === i.factId) && (!i.pageId || r.pageId === i.pageId || (r.factId && s.facts.find((f) => f.factId === r.factId)?.subject?.pageId === i.pageId)) && (!i.action || r.action === i.action) && (!i.actor || r.actor === i.actor) && (!i.since || r.at >= i.since));
    return { rows: [...rows].sort((a, b) => b.at - a.at), total: rows.length };
  });
  replica.resolve("memory.trash.search", (_t, i: CapMap["memory.trash.search"]["in"]) => {
    const s = st();
    const area = i.area ?? "trash";
    if (area === "archive" && o.member) throw new Error("permission.role_lacks_permission");
    const q = (i.q ?? "").toLowerCase();
    const list = s.facts.filter((f) => f.trashedAt !== undefined && (area === "archive" ? archived(f, s) : !archived(f, s)) && (q === "" || f.text.toLowerCase().includes(q) || (f.subject?.title ?? "").toLowerCase().includes(q))).sort((a, b) => b.trashedAt! - a.trashedAt!);
    const pages = s.trashedPages.map((id) => s.pages.find((p) => p.pageId === id)!).filter((p) => p && area === "trash");
    return { facts: list.map((f) => ({ ...strip(f), ...(archived(f, s) ? { archivedAt: f.trashedAt! + s.keep * DAY } : {}) })), pages, total: list.length };
  });
  replica.resolve("memory.questions.list", (_t, i: CapMap["memory.questions.list"]["in"]) => {
    const list = st().questions.filter((q) => (!i.status || q.status === i.status) && (!i.kind || q.kind === i.kind));
    return { questions: list, total: list.length };
  });
  replica.resolve("memory.facts.list", (_t, i: CapMap["memory.facts.list"]["in"]) => {
    const s = st();
    const list = s.facts.filter((f) => (!i.status || i.status.includes(f.status)) && (!i.layer || f.layer === i.layer) && (!i.fromMe || f.by === ME) && (!i.q || f.text.toLowerCase().includes(i.q.toLowerCase()))).map(strip);
    return { facts: list, total: list.length };
  });
  replica.resolve("memory.search", (_t, i: CapMap["memory.search"]["in"]) => {
    const s = st();
    const toks = i.q.toLowerCase().replace(/[^a-z0-9$ ]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
    const hits: CapMap["memory.search"]["out"]["hits"] = [];
    for (const f of live(s)) {
      const hay = `${f.text} ${f.subject?.title ?? ""}`.toLowerCase();
      const words = toks.filter((t) => hay.includes(t)).length;
      const meaning = toks.filter((t) => (CONCEPTS[t] ?? []).some((w) => hay.includes(w))).length;
      const score = words * 3 + meaning * 2.5;
      if (score >= 3) hits.push({ kind: "fact", factId: f.factId, title: f.subject?.title ?? "", text: f.text, trueSince: f.validFrom, layer: f.layer, ...(f.sourceLink ? { sourceLink: f.sourceLink } : {}), score, ...(f.subject ? { pageId: f.subject.pageId } : {}) } as never);
    }
    for (const p of pageRows(s)) if (toks.some((t) => p.title.toLowerCase().includes(t) || (p.alias ?? []).some((a) => a.toLowerCase() === t))) hits.push({ kind: "page", pageId: p.pageId, title: p.title, text: p.blurb ?? "", layer: p.layer, score: 5 } as never);
    hits.sort((a, b) => b.score - a.score);
    return { hits: hits.slice(0, i.limit ?? 12), tookMs: 4, meaning: { state: "on", model: "local" } };
  });
  replica.resolve("memory.meaning.status", () => ({ mode: "local" as const, state: "on" as const, model: "bge-small (local)", indexed: 41 }));
  replica.resolve("memory.counts", () => { const s = st(); return { current: live(s).length, proposed: s.facts.filter((f) => f.status === "proposed").length, fromMe: live(s).filter((f) => f.by === ME).length, autoMerged: 1 }; });
  replica.resolve("memory.upkeep.status", () => ({ month: "2025-10", spentMicros: 1_200_000, capMicros: 5_000_000, capReached: false, modelAvailable: true, openQuestions: st().questions.filter((q) => q.status === "open").length, runs: [] }));

  replica.resolve("memory.graph", (_t, i: CapMap["memory.graph"]["in"]) => {
    const s = st();
    const asOf = i.asOf ?? now;
    const allNodes: KNode[] = SUBJECTS.filter((x) => x.born <= asOf && (x.type !== "chat" || true)).map((x) => ({
      nodeId: nodeIdOf(x.id), kind: (x.type === "run" ? "record" : x.type) as GNode["kind"], title: x.name, layer: x.layer, cluster: x.type, ...(PAGEABLE.has(x.type) ? { pageId: pageIdOf(x.id) } : {}),
      ...(x.type === "chat" ? { link: `vyre://thread/${CHAT[x.id.slice(5)]!.thread}` } : {}),
    })).filter((x) => !s.trashedPages.includes(x.nodeId));
    let edges: KEdge[] = EDGES.filter((e) => T(e[7], 9) <= asOf).map(([a, b, label, quote, title, chat, , day]) => ({
      from: nodeIdOf(a), to: nodeIdOf(b), kind: "relation", label, evidence: quote, at: T(day, 9),
      source: { title, kind: chat ? "chat" : title.startsWith("#") ? "channel" : "record", ...(chat ? { link: `vyre://thread/${CHAT[chat]!.thread}?m=msg_${chat}_0` } : {}) },
    } as KEdge));
    let nodes = allNodes;
    if (i.focus) {
      const hops = i.hops ?? 2;
      const keep = new Set<string>([i.focus]);
      for (let h = 0; h < hops; h++) { const was = new Set(keep); for (const e of edges) { if (was.has(e.from)) keep.add(e.to); if (was.has(e.to)) keep.add(e.from); } }
      nodes = nodes.filter((n) => keep.has(n.nodeId));
    }
    nodes = nodes.filter((n) => (!i.kinds || i.kinds.length === 0 || i.kinds.includes(n.kind)) && (!i.layers || i.layers.length === 0 || i.layers.includes(n.layer ?? "space")));
    const ids = new Set(nodes.map((n) => n.nodeId));
    edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const by = new Map<string, KNode[]>();
    for (const n of nodes) by.set(n.cluster ?? "", [...(by.get(n.cluster ?? "") ?? []), n]);
    return { nodes, edges, clusters: [...by].map(([name, list]) => ({ name, hub: list[0]!.nodeId, size: list.length })) } as never;
  });
  replica.resolve("memory.layout.get", () => ({ positions: {} }));
  replica.resolve("memory.notes.list", () => ({ notes: [], total: 0 }));

  // ------------------------------------------------------------ writes
  const writes: Record<string, (i: never) => unknown> = {
    "memory.undo": (i: { factId: string }) => {
      const s = st(), f = find(s, i.factId);
      f.status = "removed"; f.trashedAt = now; f.trashReason = "undone";
      log(s, "undo", ME, label(f), "Undone by you", f.factId);
      save(s);
      return { fact: strip(f), trashed: true };
    },
    "memory.restore": (i: { factId?: string; pageId?: string }) => {
      const s = st();
      if (i.pageId) { s.trashedPages = s.trashedPages.filter((p) => p !== i.pageId); log(s, "restore", ME, `Page ${i.pageId}`, "Restored from Trash", undefined, i.pageId); save(s); return { page: s.pages.find((p) => p.pageId === i.pageId), restoredFrom: "trash" as const }; }
      const f = find(s, i.factId!);
      const from = archived(f, s) ? "archive" as const : "trash" as const;
      if (from === "archive" && o.member) throw new Error("permission.role_lacks_permission");
      f.status = "current"; delete f.trashedAt; delete f.trashReason; delete f.archivedAt;
      log(s, "restore", ME, label(f), from === "archive" ? "Restored from Archive" : "Restored from Trash", f.factId);
      save(s);
      return { fact: strip(f), restoredFrom: from };
    },
    "memory.fact.correct": (i: { factId: string; text: string }) => {
      const s = st(), old = find(s, i.factId);
      const next = { ...structuredClone(old), factId: `fct_n${++s.seq}`, text: i.text, learnedAt: now, validFrom: now, by: ME, byKind: "person" as const, versions: (old.versions ?? 1) + 1, _history: [...old._history, { at: old.learnedAt, by: old.by ?? ME, text: old.text }] };
      old.status = "closed"; old.closedAt = now; old.validTo = now;
      s.facts.splice(s.facts.indexOf(old) + 1, 0, next);
      log(s, "edit", ME, `${old.subject?.title ?? "A page"}: ${i.text} (was ${old.text})`, "Corrected by you", next.factId);
      save(s);
      return { fact: strip(next), closed: strip(old) };
    },
    "memory.question.resolve": (i: { questionId: string; resolution: "keep_a" | "keep_b" | "keep_both" | "drop" }) => {
      const s = st(), q = s.questions.find((x) => x.questionId === i.questionId);
      if (!q) throw new Error("validation.not_found");
      const [a, b] = q.facts;
      const gone = i.resolution === "keep_a" ? b : i.resolution === "keep_b" ? a : undefined;
      if (gone) { const f = find(s, gone.factId); f.status = "removed"; f.trashedAt = now; f.trashReason = "Replaced by the other address"; log(s, "resolve", ME, label(f), "You picked the other one", f.factId); }
      q.status = "resolved"; q.resolution = i.resolution;
      save(s);
      return { ok: true, resolution: i.resolution };
    },
    "memory.page.put": (i: { pageId: string; notes: string; baseVersion?: number }) => {
      const s = st(), p = s.pages.find((x) => x.pageId === i.pageId);
      if (!p) throw new Error("validation.not_found");
      const cur = s.notes[i.pageId] ?? { text: "", by: ME, at: now, version: 0, versions: [] };
      if (i.baseVersion !== undefined && cur.version !== 0 && i.baseVersion !== cur.version) throw new Error("validation.precondition_failed");
      const version = cur.version + 1;
      s.notes[i.pageId] = { text: i.notes, by: ME, at: now, version, versions: [...cur.versions, { version, by: ME, at: now, notes: i.notes }] };
      p.version = version; p.updatedAt = now;
      log(s, "edit", ME, `${p.title}: Notes`, "Notes edited", undefined, p.pageId);
      save(s);
      return { page: p, created: false, links: [...i.notes.matchAll(/\[\[/g)].length };
    },
    "memory.page.restore_version": (i: { pageId: string; version: number }) => {
      const s = st(), n = s.notes[i.pageId], v = n?.versions.find((x) => x.version === i.version);
      if (!n || !v) throw new Error("validation.not_found");
      const version = n.version + 1;
      s.notes[i.pageId] = { ...n, text: v.notes, by: ME, at: now, version, versions: [...n.versions, { version, by: ME, at: now, notes: v.notes }] };
      save(s);
      return { page: s.pages.find((p) => p.pageId === i.pageId) };
    },
    "memory.page.delete": (i: { pageId: string }) => {
      const s = st(), p = s.pages.find((x) => x.pageId === i.pageId);
      if (!p) throw new Error("validation.not_found");
      s.trashedPages.push(i.pageId);
      log(s, "delete", ME, `Page ${p.title}`, "Moved to Trash", undefined, p.pageId);
      save(s);
      return { page: p, trashed: true };
    },
    "memory.remember": (i: { text: string; layer?: KFact["layer"]; threadId?: string; sourceRef?: string }) => {
      const s = st();
      const f = F("ian", i.text, i.layer ?? "person", now, { k: "chat", label: "This chat", who: "Irfad Imtiaz" }, "Irfad Imtiaz");
      s.facts.unshift(structuredClone(f)); log(s, "create", ME, i.text, "Remembered from a message", f.factId);
      save(s);
      return { fact: strip(f), merged: false };
    },
    "memory.forget": (i: { factIds: string[] }) => {
      const s = st();
      for (const id of i.factIds) { const f = find(s, id); f.status = "removed"; f.trashedAt = now; f.trashReason = "removed"; log(s, "delete", ME, label(f), "Forgotten by you", id); }
      save(s);
      return { removed: i.factIds.length };
    },
    "memory.fact.accept": (i: { factId: string }) => { const s = st(), f = find(s, i.factId); f.status = "current"; save(s); return { fact: strip(f) }; },
    "memory.fact.reject": (i: { factId: string }) => { const s = st(), f = find(s, i.factId); f.status = "removed"; f.closedAt = now; save(s); return { fact: strip(f) }; },
    "memory.layout.save": () => ({ ok: true }),
    "memory.graph_export": () => ({ fileId: "fil_export_1" }),
  };

  const data: MemoryData = {
    live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]> { return liveQuery(replica, cap, input); },
    async call(cap, input) {
      calls.push({ cap, input });
      if (o.fail) throw new Error(o.fail);
      const w = writes[cap];
      if (!w) throw new Error(`unknown capability ${cap}`);
      return w(input as never);
    },
    now: () => now,
    agents: Object.entries(AGENTS).map(([id, name]) => ({ id, name })),
    nameOf,
    me: { id: ME, name: PEOPLE[ME]! },
    nav: {
      openNote: (id) => void opened.push(`note:${id}`), openSource: (link) => void opened.push(`source:${link}`),
      go: (r) => void opened.push(`go:${JSON.stringify(r)}`), openChat: (link) => void opened.push(`chat:${link}`),
    },
  };
  return { data, replica, calls, opened, snapshot: st };
}

const STOP = new Set(["how", "does", "the", "from", "for", "and", "with", "what", "who", "should", "when"]);
const CONCEPTS: Record<string, string[]> = {
  hear: ["update", "updates", "friday", "email"], touch: ["update", "updates"], contact: ["email", "phone", "update"], consults: ["consult"], charge: ["fee", "$", "charges"], first: ["consult"],
};
