// A held send in Needs you: an agent tried to send an email and the Gate parked it. The task carries the whole input of mail.send (doc_excerpt block, { act, cap, input }), so the person can read the
// draft as it will go out, with the record it is about beside it. This is the pure part: finding the draft in the task, the words of the buttons, and the lines of the record's peek.
import type { CapMap } from "../../../../../../generated/types.ts";

type Task = CapMap["tasks.list"]["out"]["tasks"][number];
export interface HeldMail { to: string[]; cc: string[]; subject: string; body: string; attachments: number; recordId?: string }

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const who = (r: unknown): string => (isRec(r) ? (text(r["name"]) ? `${text(r["name"])} <${text(r["address"])}>` : text(r["address"])) : "");

/** The words of an HTML body, as plain lines: tags out, breaks kept, the common entities back. */
export function plainOf(html: string): string {
  return html.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}

/** The draft in a held mail.send, or null for any other task. */
export function heldMail(t: Pick<Task, "kind" | "blocks">): HeldMail | null {
  if (t.kind !== "approve") return null;
  for (const b of t.blocks) {
    const d = b.data;
    if (!isRec(d) || d["cap"] !== "mail.send" || !isRec(d["input"])) continue;
    const i = d["input"];
    const to = (Array.isArray(i["to"]) ? i["to"] : []).map(who).filter((x) => x !== "");
    const cc = (Array.isArray(i["cc"]) ? i["cc"] : []).map(who).filter((x) => x !== "");
    const contact = text(i["contactId"]) || (Array.isArray(i["to"]) ? (i["to"] as unknown[]).map((r) => (isRec(r) ? text(r["contactId"]) : "")).find((x) => x !== "") ?? "" : "");
    return { to, cc, subject: text(i["subject"]), body: text(i["text"]) || plainOf(text(i["html"])), attachments: Array.isArray(i["attachments"]) ? i["attachments"].length : 0, ...(contact ? { recordId: contact } : {}) };
  }
  return null;
}

/** What the two buttons of a held send say: Send goes out as written, and asking for changes sends it back to the agent with the person's note. */
export const HELD_LABELS = { approve: "Send", send_back: "Ask for changes" } as const;
export function labelOf(held: HeldMail | null, a: { key: string; label: string }): string {
  if (!held) return a.label;
  return a.key === "approve" ? HELD_LABELS.approve : a.key === "send_back" || a.key === "reject" ? HELD_LABELS.send_back : a.label;
}

export interface Peek { title: string; type: string; lines: [string, string][] }
const SKIP = new Set(["name", "title", "folder", "id"]);
const label = (k: string): string => k.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
/** A few lines of the record the draft is about: its name, and up to four of its filled fields, in the record's own order. */
export function peekOf(rec: { type: string; fields: Record<string, unknown> }, titleField = "name"): Peek {
  const lines: [string, string][] = [];
  for (const [k, v] of Object.entries(rec.fields)) {
    if (SKIP.has(k) || k === titleField || lines.length >= 4) continue;
    const s = typeof v === "string" || typeof v === "number" ? String(v) : isRec(v) && typeof v["amount"] === "number" ? `${v["amount"]} ${text(v["currency"])}`.trim() : "";
    if (s) lines.push([label(k), s.length > 60 ? `${s.slice(0, 59)}…` : s]);
  }
  const title = text(rec.fields[titleField]) || text(rec.fields["name"]) || "Record";
  return { title, type: label(rec.type), lines };
}
