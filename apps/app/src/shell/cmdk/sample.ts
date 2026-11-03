// Sample Space for the Cmd-K mount and tests: the Northwind replica holds private chats and the people it syncs, the server adds shared content.
// Matching is a plain case-insensitive contains over title, snippet and path, the way a small FTS would answer a short query.
import { skins } from "../../../../../ui/src/tokens/skins.ts";
import type { CmdKData } from "./controller.ts";
import type { AskAnswer, AskSource, CmdAction, Hit, HitKind } from "./model.ts";

const hit = (kind: HitKind, id: string, title: string, extra: Partial<Hit> = {}): Hit => ({ kind, id, title, link: `vyre://${kind}/${id}`, score: 1, ...extra });

export const LOCAL_HITS: readonly Hit[] = [
  hit("agent", "ag_intake", "Intake", { snippet: "Intake agent, answers new enquiries", score: 0.9 }),
  hit("agent", "ag_docs", "Docs", { snippet: "Drafts and files documents", score: 0.8 }),
  hit("agent", "ag_billing", "Billing", { snippet: "Invoices and trust accounting", score: 0.8 }),
  hit("person", "pe_maya", "Maya Chen", { snippet: "Northwind, partner", score: 0.9 }),
  hit("person", "pe_omar", "Omar Haddad", { snippet: "Harbor Legal", score: 0.8 }),
  hit("person", "pe_lena", "Lena Voss", { snippet: "Voss & Park", score: 0.8 }),
  hit("chat", "ch_ref", "Referral questions", { snippet: "Intake: which referral source counts for the fee split?", score: 0.9 }),
  hit("chat", "ch_renew", "Harbor Legal renewal", { snippet: "Docs: renewal letter is ready for review", score: 0.7 }),
  hit("record", "rec_reflog", "Referral fee log", { snippet: "Record, 41 rows, updated today", score: 0.9 }),
  hit("record", "rec_northwind", "Northwind intake", { snippet: "Matter, open", score: 0.7 }),
  hit("file", "fi_refagr", "Referral agreement.pdf", { path: "Contracts / Partners", score: 0.9 }),
  hit("file", "fi_engage", "Engagement letter.docx", { path: "Contracts / Clients", score: 0.7 }),
  hit("automation", "au_ref", "Referral thank-you", { snippet: "Journey, sends after a closed matter", score: 0.8 }),
  hit("app", "ap_intake", "Intake form", { snippet: "Public form, 12 submissions this week", score: 0.7 }),
  hit("setting", "se_notif", "Notifications", { snippet: "Settings, how you are told", score: 0.6 }),
  hit("inbox", "ib_vp", "Voss & Park: signed engagement", { snippet: "Email from Lena Voss, Tuesday", score: 0.7 }),
];

/** Shared content the device may not hold yet. */
export const SERVER_HITS: readonly Hit[] = [
  hit("file", "fi_refpolicy", "Referral policy 2026.docx", { path: "Firm / Policies", snippet: "Referral fees follow the state bar rule", score: 0.95 }),
  hit("record", "rec_refpartner", "Referral partners", { snippet: "Record, 18 rows, shared with Marketing", score: 0.85 }),
  hit("channel", "cn_refer", "#referrals", { snippet: "Channel: partner introductions", score: 0.8 }),
  hit("record", "rec_reflog", "Referral fee log", { snippet: "Record, 41 rows, updated today: Q3 fee splits", score: 0.9 }),
];

export const ACTIONS: readonly CmdAction[] = [
  { key: "task.new", title: "New task", icon: "plus", keys: "Cmd-N" },
  { key: "call.start", title: "Call Elena", icon: "link" },
  { key: "appearance.skin", title: "Switch skin", icon: "eye" },
  { key: "presence.away", title: "Set yourself away", icon: "clock" },
  { key: "network.offline", title: "Go offline", icon: "x" },
];

const has = (h: Hit, q: string): boolean => `${h.title} ${h.snippet ?? ""} ${h.path ?? ""}`.toLowerCase().includes(q.toLowerCase());

const src = (n: number, kind: HitKind, id: string, title: string, where: string, extra: Partial<Hit> = {}): AskSource => ({ n, where, ...hit(kind, id, title, extra) });

/** The answer behind the Ask the Space scenes: Elena and the lease, four sources a person may read. */
export const SAMPLE_ANSWER: AskAnswer = {
  state: "answered",
  answer: "Elena asked for the lease documents by Thursday [1]. Intake booked her consult for Thursday at 10:00 [2], and the engagement letter is drafted and waits for her signature [3]. The project is in Drafting, due 14 Nov [4].",
  sources: [
    src(1, "inbox", "ib_lease", "Lease documents for Thursday", "Inbox", { snippet: "Elena Rivera, 2 Nov" }),
    src(2, "inbox", "ib_consult", "Rivera consult", "Meeting", { snippet: "Thursday 10:00, with Intake" }),
    src(3, "file", "fi_engage_letter", "rivera-engagement-letter.docx", "File", { path: "Projects / Rivera matter" }),
    src(4, "record", "rec_rivera", "Rivera engagement", "Record", { snippet: "Project, Drafting" }),
  ],
  cited: [1, 2, 3, 4],
  account: { title: "Claude", mine: true },
};
export const SAMPLE_NO_ACCESS: AskAnswer = { state: "no_access", answer: "I can't see anything about that you can read.", sources: [], cited: [], account: { title: "Claude", mine: true } };

export interface SampleOptions {
  /** Ask the Space on (the default answer, or your own). Left out: the search offers no Ask row. */
  ask?: boolean | ((question: string) => Promise<AskAnswer>);
  serverDelayMs?: number;
  scope?: "space" | "device";
  online?: boolean;
  skin?: string;
  local?: readonly Hit[];
  server?: readonly Hit[];
}

export interface SampleCalls {
  previews: (string | null)[];
  setSkins: string[];
  opened: { id: string; newTab: boolean }[];
  copied: string[];
  ran: string[];
  recorded: string[];
  asked: string[];
  answerCopied: string[];
  chats: { question: string; answer: string }[];
}

export function createSampleData(opts: SampleOptions = {}): { data: CmdKData; calls: SampleCalls } {
  const calls: SampleCalls = { previews: [], setSkins: [], opened: [], copied: [], ran: [], recorded: [], asked: [], answerCopied: [], chats: [] };
  const local = opts.local ?? LOCAL_HITS;
  const server = opts.server ?? SERVER_HITS;
  const data: CmdKData = {
    spaceName: () => "Northwind",
    scope: () => opts.scope ?? "space",
    online: () => opts.online ?? true,
    local: (text, types) => local.filter((h) => (!types || types.includes(h.kind)) && (text === "" || has(h, text))),
    server: (text, types) => new Promise((resolve) => {
      setTimeout(() => resolve(server.filter((h) => (!types || types.includes(h.kind)) && (text === "" || has(h, text)))), opts.serverDelayMs ?? 120);
    }),
    recent: () => [local[6] as Hit, local[3] as Hit, local[10] as Hit, local[0] as Hit],
    actions: (text) => ACTIONS.filter((a) => !text || a.title.toLowerCase().includes(text.toLowerCase())),
    skins: () => skins.map((s) => ({ id: s.id, name: s.name, swatch: s.palette.accent })),
    currentSkin: () => opts.skin ?? "paper",
    previewSkin: (id) => { calls.previews.push(id); },
    setSkin: (id) => { calls.setSkins.push(id); },
    open: (h, o) => { calls.opened.push({ id: h.id, newTab: o.newTab }); },
    copyLink: (h) => { calls.copied.push(h.link); },
    runAction: (a) => { calls.ran.push(a.key); },
    recordOpened: (h) => { calls.recorded.push(h.id); },
    ...(opts.ask ? {
      ask: (q: string) => { calls.asked.push(q); return typeof opts.ask === "function" ? opts.ask(q) : Promise.resolve(SAMPLE_ANSWER); },
      copyText: (t: string) => { calls.answerCopied.push(t); },
      continueInChat: (c: { question: string; answer: string }) => { calls.chats.push(c); },
    } : {}),
  };
  return { data, calls };
}
