// Send for signature: what the sheet holds and what a file, a record and the Needs-you line say about a request. Pure: the screen and the tests share it.
// The words are one set everywhere (P6 section 5): Sent, Opened, Signed, Declined, Not signed in time, Cancelled. Copy never says "legally binding": the page records who signed and when.

export interface SignerDraft {
  /** A stable key for the row, so a removal does not move what a person typed. */
  key: string;
  name: string;
  email: string;
}

export interface SignProblem {
  /** The row the problem is on, or null for the sheet. */
  key: string | null;
  text: string;
}

let seq = 0;
export const blankSigner = (name = "", email = ""): SignerDraft => ({ key: `s${++seq}`, name, email });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A row with nothing in it does not count: the sheet always keeps one empty row to type into. */
export const isBlank = (d: SignerDraft): boolean => d.name.trim() === "" && d.email.trim() === "";

/** What stops Send, in plain words, row by row. A signer needs a name; the email is optional on a Space that hands out links, but a typed email must be one. */
export function problemsOf(drafts: readonly SignerDraft[]): SignProblem[] {
  const rows = drafts.filter((d) => !isBlank(d));
  if (rows.length === 0) return [{ key: null, text: "Add the person who signs." }];
  const out: SignProblem[] = [];
  for (const d of rows) {
    if (d.name.trim() === "") out.push({ key: d.key, text: "Give this person a name." });
    else if (d.email.trim() !== "" && !EMAIL.test(d.email.trim()))
      out.push({ key: d.key, text: `${first(d.name)}'s email needs another look.` });
  }
  return out;
}

export const first = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

export interface SendInput {
  fileId: string;
  recordId?: string;
  signers: { name: string; email?: string; order: number }[];
  message?: string;
  idempotencyKey: string;
}

/** The call's input from the sheet. Everyone signs at once unless the person asks for one after another (then in the order listed); an empty email is left out, not sent as an empty string. */
export function sendInput(
  fileId: string,
  recordId: string | undefined,
  drafts: readonly SignerDraft[],
  message: string,
  key: string,
  oneAfterAnother = false,
): SendInput {
  const signers = drafts
    .filter((d) => !isBlank(d))
    .map((d, i) => ({
      name: d.name.trim(),
      ...(d.email.trim() !== "" ? { email: d.email.trim() } : {}),
      order: oneAfterAnother ? i + 1 : 1,
    }));
  return {
    fileId,
    ...(recordId ? { recordId } : {}),
    signers,
    ...(message.trim() !== "" ? { message: message.trim() } : {}),
    idempotencyKey: key,
  };
}

export type EnvState = "approval" | "sent" | "viewed" | "signed" | "declined" | "cancelled" | "expired";

export interface SignerView {
  name: string;
  email?: string;
  state: "waiting" | "sent" | "viewed" | "signed" | "declined" | "cancelled" | "expired";
  /** Where they sit in the order; equal numbers sign at the same time. */
  order?: number;
  signedAt?: number;
}

export interface Envelope {
  id: string;
  title: string;
  state: EnvState;
  signers: SignerView[];
  /** When it was sent, signed or ended (ms). */
  at?: number;
  /** The file that was sent. */
  fileId?: string;
  /** The signed copy: the file beside the original, whose last page is the audit page. */
  signedFileId?: string;
  recordId?: string;
  declinedBy?: string;
  declinedReason?: string;
  expiresAt?: number;
}

const STATES: readonly EnvState[] = ["approval", "sent", "viewed", "signed", "declined", "cancelled", "expired"];
const SIGNER_STATES = ["waiting", "sent", "viewed", "signed", "declined", "cancelled", "expired"] as const;
const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** One envelope from whatever the server returned (esign.list and esign.status rows). Unknown words fall to the quietest state; nothing throws. */
export function envelopeOf(raw: unknown): Envelope | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.envelopeId) ?? str(r.id);
  if (!id) return null;
  const s = str(r.status) ?? str(r.state) ?? "sent";
  const state = (STATES as readonly string[]).includes(s) ? (s as EnvState) : "sent";
  const signers = (Array.isArray(r.signers) ? r.signers : []).flatMap((x): SignerView[] => {
    if (x === null || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const st = str(o.status) ?? str(o.state) ?? "sent";
    const email = str(o.email);
    const signedAt = num(o.signedAt);
    return [
      {
        name: str(o.name) ?? email ?? "Signer",
        ...(email ? { email } : {}),
        state: (SIGNER_STATES as readonly string[]).includes(st) ? (st as SignerView["state"]) : "sent",
        ...(typeof o.order === "number" ? { order: o.order } : {}),
        ...(signedAt !== undefined ? { signedAt } : {}),
      },
    ];
  });
  const lastSigned = Math.max(0, ...signers.map((x) => x.signedAt ?? 0));
  const at = (lastSigned > 0 ? lastSigned : undefined) ?? num(r.signedAt) ?? num(r.createdAt) ?? num(r.at);
  const signedFileId = str(r.signedFileId);
  const fileId = str(r.fileId);
  const recordId = str(r.recordId);
  const declinedBy = signers.find((x) => x.state === "declined")?.name;
  const declinedReason = str(r.declinedReason);
  const expiresAt = num(r.expiresAt);
  return {
    id,
    title: str(r.title) ?? "Document",
    state,
    signers,
    ...(at !== undefined ? { at } : {}),
    ...(fileId ? { fileId } : {}),
    ...(state === "signed" && signedFileId ? { signedFileId } : {}),
    ...(recordId ? { recordId } : {}),
    ...(declinedBy ? { declinedBy } : {}),
    ...(declinedReason ? { declinedReason } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

/** The newest open request first, else the newest of any. A file can have an old cancelled one behind a live one; the live one is what a person cares about. */
export function current(list: readonly Envelope[]): Envelope | null {
  const open = list.find((e) => e.state === "approval" || e.state === "sent" || e.state === "viewed");
  return open ?? list[0] ?? null;
}

export const isOpen = (e: Envelope): boolean => e.state === "approval" || e.state === "sent" || e.state === "viewed";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "14 Nov", or "14 Nov 2025" when the year is not this one. `zoneOffsetMin` is the Space's time zone. */
export function dayWords(ms: number, now: number, zoneOffsetMin = 0): string {
  const d = new Date(ms + zoneOffsetMin * 60000);
  const n = new Date(now + zoneOffsetMin * 60000);
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === n.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

/** The names still to sign, as "Andrea", "Andrea and Imran", "Andrea, Imran and 1 more". */
export function names(list: readonly string[]): string {
  const f = list.map(first);
  if (f.length <= 1) return f[0] ?? "";
  if (f.length === 2) return `${f[0]} and ${f[1]}`;
  return `${f[0]}, ${f[1]} and ${f.length - 2} more`;
}

export type Tone = "ok" | "quiet" | "warn" | "bad";

/** The one quiet line a file shows in its header and a record shows beside the envelope. */
export function statusLine(e: Envelope, now: number, zone = 0): { tone: Tone; label: string; note?: string } {
  const waiting = e.signers.filter((s) => s.state !== "signed" && s.state !== "declined").map((s) => s.name);
  const day = e.at !== undefined ? dayWords(e.at, now, zone) : undefined;
  switch (e.state) {
    case "approval":
      return { tone: "quiet", label: "Waiting for approval" };
    case "signed":
      return {
        tone: "ok",
        label: day ? `Signed on ${day}` : "Signed",
        ...(e.signers.length > 0 ? { note: `By ${names(e.signers.map((s) => s.name))}` } : {}),
      };
    case "declined":
      return { tone: "bad", label: e.declinedBy ? `${first(e.declinedBy)} declined` : "Signing declined" };
    case "cancelled":
      return { tone: "quiet", label: "Cancelled" };
    case "expired":
      return { tone: "warn", label: "Not signed in time" };
    default: {
      // sent or opened: the line names who it waits for; who has opened it is the quiet note
      const opened = e.signers.filter((x) => x.state === "viewed").map((x) => x.name);
      return {
        tone: "quiet",
        label: waiting.length > 0 ? `Waiting for ${names(waiting)}` : "Sent",
        ...(opened.length > 0 ? { note: `${names(opened)} opened it` } : {}),
      };
    }
  }
}

export interface SentLink {
  index: number;
  name: string;
  email?: string;
  /** The address to paste: the Space's public address when it has one, else the path on the address the app runs at. */
  url: string;
}

/** The address of a link, whole: `origin` is where the app runs, used only when the server gave a path without the Space's public address. */
export const linkOf = (l: { url?: unknown; path?: unknown }, origin: string): string | null => {
  const url = str(l.url);
  if (url) return url;
  const path = str(l.path);
  return path ? origin.replace(/\/$/, "") + path : null;
};

/** What the server answered to a send (or a remind), for the sent state: each signer's link, who was emailed, and its own sentence when no mail went out. */
export function sentOf(
  out: unknown,
  origin = "",
): { id: string | null; links: SentLink[]; emailed: string[]; notice: string | null } | null {
  if (out === null || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  const id = str(o.envelopeId) ?? null;
  const raw = Array.isArray(o.links) ? o.links : o.link && typeof o.link === "object" ? [o.link] : [];
  const links = raw.flatMap((x, i): SentLink[] => {
    if (x === null || typeof x !== "object") return [];
    const l = x as Record<string, unknown>;
    const url = linkOf(l, origin);
    if (!url) return [];
    const email = str(l.email);
    return [
      {
        index: typeof l.index === "number" ? l.index : i,
        name: str(l.name) ?? email ?? "Signer",
        ...(email ? { email } : {}),
        url,
      },
    ];
  });
  if (id === null && links.length === 0) return null;
  const emailed = Array.isArray(o.emailed) ? o.emailed.filter((e): e is string => typeof e === "string") : [];
  return { id, links, emailed, notice: str(o.notice) ?? null };
}

/** The sent state's one plain line about mail, from what the server answered. Never a dead end: with no mailbox the person is told to copy the links. */
export function mailWords(emailed: readonly string[], notice: string | null, count: number): string {
  if (emailed.length > 0)
    return `Emailed to ${emailed.length === 1 ? emailed[0] : `${emailed.length} people`}. The link below works too.`;
  if (notice) return notice;
  return count === 1 ? "Copy the link and send it to them." : "Copy each link and send it to the person it is for.";
}

/** A PDF is what the built-in signer takes (a Word file is refused by the server in its own sentence, so the door is not offered for one). */
export const canSignFile = (name: string, mime?: string): boolean => /\.pdf$/i.test(name) || mime === "application/pdf";
