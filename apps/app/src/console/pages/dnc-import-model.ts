// The do-not-contact CSV file, read before anything is sent: one column of email addresses or phone numbers (the first), an optional header row, and an optional "reason" column.
// The server reads one channel and one reason per file (contacts.suppression.import), so the model also splits what it read into one small file per channel and reason.
// No React and no calls here, so the counting a person confirms ("Add 214 people to the do-not-contact list") is the same count the files carry.

export type DncChannel = "email" | "sms";
export type DncReason = "do_not_contact" | "unsubscribe" | "stop" | "manual" | "bounce_hard" | "complaint";

export interface DncGroup { channel: DncChannel; reason: DncReason; addresses: string[] }
export interface DncFile {
  /** Everyone the file would add, once each. */
  total: number;
  emails: number;
  phones: number;
  /** Rows that are not an address, and repeats. */
  skipped: number;
  /** Per channel and reason; a row with no reason of its own takes the one chosen on the page. */
  groups: DncGroup[];
}

const HEADER_CELLS = new Set(["email", "emails", "email address", "e-mail", "address", "phone", "phones", "phone number", "number", "mobile", "cell"]);
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const PHONE = /^\+?[\d\s().-]{6,}$/;

const WORDS: readonly [RegExp, DncReason][] = [
  [/^(unsubscribe|unsubscribed|opt.?out|opted.?out)$/, "unsubscribe"],
  [/^(stop|texted stop)$/, "stop"],
  [/^(bounce|bounced|hard bounce|bounce hard)$/, "bounce_hard"],
  [/^(complaint|complained|spam)$/, "complaint"],
  [/^(manual|by hand|added by hand)$/, "manual"],
  [/^(do.?not.?contact|dnc|dnd)$/, "do_not_contact"],
];
/** The list reason a word in the reason column stands for, or null when it names none (the page's choice then applies). */
export function reasonOf(word: string): DncReason | null {
  const w = word.trim().toLowerCase().replace(/[_-]+/g, " ");
  for (const [pattern, reason] of WORDS) if (pattern.test(w.replace(/\s+/g, " ")) || pattern.test(w.replace(/\s+/g, ""))) return reason;
  return null;
}

/** One line into cells, with plain quoting ("a, b") honoured. */
export function cellsOf(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? "";
    if (quoted) {
      if (c === "\"" && line[i + 1] === "\"") { cur += "\""; i++; } else if (c === "\"") quoted = false; else cur += c;
    } else if (c === "\"") quoted = true;
    else if (c === "," || c === ";" || c === "\t") { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const digitsOf = (v: string): string => v.replace(/\D/g, "");

/** Reads the text of a CSV file. `fallback` is the reason for rows that name none. */
export function parseDncFile(text: string, fallback: DncReason): DncFile {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  let reasonCol = -1;
  let start = 0;
  const head = lines[0] ? cellsOf(lines[0]) : [];
  if (head.length > 0 && HEADER_CELLS.has((head[0] ?? "").toLowerCase())) {
    start = 1;
    reasonCol = head.findIndex((c, i) => i > 0 && c.toLowerCase() === "reason");
  }
  const seen = new Set<string>();
  const groups = new Map<string, DncGroup>();
  let skipped = 0;
  let emails = 0;
  let phones = 0;
  for (const line of lines.slice(start)) {
    const cells = cellsOf(line);
    const value = (cells[0] ?? "").trim();
    const channel: DncChannel | null = EMAIL.test(value) ? "email" : PHONE.test(value) && digitsOf(value).length >= 7 ? "sms" : null;
    if (channel === null) { skipped++; continue; }
    const address = channel === "email" ? value.toLowerCase() : value;
    const key = channel === "email" ? address : `+${digitsOf(value)}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const reason = (reasonCol >= 0 ? reasonOf(cells[reasonCol] ?? "") : null) ?? fallback;
    const slot = `${channel}:${reason}`;
    const group = groups.get(slot) ?? { channel, reason, addresses: [] };
    group.addresses.push(address);
    groups.set(slot, group);
    if (channel === "email") emails++; else phones++;
  }
  return { total: emails + phones, emails, phones, skipped, groups: [...groups.values()] };
}

/** The file the server reads for one group: a header and one address a line. */
export function groupCsv(g: DncGroup): string {
  return `${g.channel === "email" ? "email" : "phone"}\n${g.addresses.join("\n")}\n`;
}

/** The sentence on the confirm button. */
export const addLabel = (n: number): string => `Add ${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"} to the do-not-contact list`;

/** What was in the file, said plainly under the button. */
export function describeFile(f: DncFile): string {
  const parts = [f.emails > 0 ? `${f.emails.toLocaleString("en-US")} ${f.emails === 1 ? "email" : "emails"}` : "", f.phones > 0 ? `${f.phones.toLocaleString("en-US")} ${f.phones === 1 ? "phone number" : "phone numbers"}` : ""].filter(Boolean);
  const left = f.skipped > 0 ? ` ${f.skipped.toLocaleString("en-US")} ${f.skipped === 1 ? "row was" : "rows were"} left out: not an address, or a repeat.` : "";
  return `${parts.join(" and ")}.${left}`;
}
