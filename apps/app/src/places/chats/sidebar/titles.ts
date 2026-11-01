// What an untitled chat is called in the list. The server never writes any part of a message into a thread title, so an unnamed chat reads from who is in it and the
// day it began ("Mailer · Oct 31"). The device that sent the first message also keeps that message's first line, in its own storage, and shows it in place of the default on that device only.
// A title someone gave on purpose always wins over both.
import type { ChatRow } from "./model.ts";

const KEY = "vyre.chat-titles.v1";
const MAX = 48;
const DEFAULT_TITLES: ReadonlySet<string> = new Set(["", "New chat"]);

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const store = (): Store | null => {
  try { return (globalThis as { localStorage?: Store }).localStorage ?? null; } catch { return null; }
};
const read = (): Record<string, string> => {
  try { const raw = store()?.getItem(KEY); const o = raw ? (JSON.parse(raw) as unknown) : null; return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, string>) : {}; } catch { return {}; }
};

/** The first line of a message, without mentions or markup, at most MAX characters and cut at a word; null when nothing readable is left. */
export function firstLine(text: string): string | null {
  const line = text.split("\n").map((l) => l.replace(/[`*_>#~]|\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/@\w[\w.-]*/g, "").replace(/\s+/g, " ").trim()).find((l) => l !== "") ?? "";
  if (line.length < 2) return null;
  if (line.length <= MAX) return line.replace(/[.:;,]+$/, "");
  const cut = line.slice(0, MAX), at = cut.lastIndexOf(" ");
  return `${(at > 24 ? cut.slice(0, at) : cut).replace(/[.:;,\s]+$/, "")}…`;
}

/** Keeps a chat's first line on this device, once: the first message sent from here names the chat here. */
export function rememberFirstLine(threadId: string, text: string): void {
  const line = firstLine(text);
  const s = store();
  if (line === null || s === null) return;
  try {
    const all = read();
    if (all[threadId] !== undefined) return;
    all[threadId] = line;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete all[k];
    s.setItem(KEY, JSON.stringify(all));
  } catch { /* the default title stands */ }
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Mailer · Oct 31": who the chat is with and the day it began, read in the person's own offset. */
export function defaultTitle(who: string, at: number, offsetMin: number): string {
  const d = new Date(at + offsetMin * 60_000);
  return `${who} · ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** What the list shows for a chat: its title when someone gave it one, else this device's first line, else who and when. */
export function displayTitle(row: Pick<ChatRow, "threadId" | "title" | "who" | "lastAt">, offsetMin: number): string {
  if (!DEFAULT_TITLES.has(row.title)) return row.title;
  return read()[row.threadId] ?? defaultTitle(row.who, row.lastAt, offsetMin);
}
