// events.compact (P-CC_41): erase reaches the append-only log. Every event commits to its payload as commit = sha256(salt || payload), and the hash chain covers the envelope with that commit, so the log can
// drop a payload and its salt and still verify (LogStore.erase). This file is the other half: choosing which events belong to an erased subject, doing it once, remembering that it was done, and leaving no
// readable copy of the payload text in the database file.
//   what is erased   the payloads (and their salts) of: every event about an erased entity (entity and entity_id); every event a person wrote (actor) or that was written for them (on_behalf); every event about
//                    them as an entity; and any event whose payload text names one of the subject's identifiers (id, email, phone, name). Envelopes stay: ids and field names are not personal text and the chain needs them.
//   what is left     {"erased":true} as the payload. A projection rebuild must treat such an event as a no-op (isErased), so an erased subject's purged rows do not come back.
//   the file         freed pages keep their bytes unless SQLite is told otherwise, so with a database handle the call runs under PRAGMA secure_delete, checkpoints the WAL and vacuums.
//   once             an event already erased is counted and skipped; running it again changes nothing; one tombstones row (kind "events") per subject is what a restore replays.
import type { DatabaseSync } from "node:sqlite";
import type { ReadQuery, StoredEvent } from "../log/index.ts";

/** The log as compaction needs it: LogStore, or LogClient (its methods answer through a worker, so they may return promises). */
export interface CompactPort {
  read(q: ReadQuery): StoredEvent[] | Promise<StoredEvent[]>;
  erase(seq: number): boolean | Promise<boolean>;
}

export interface CompactSubject {
  /** Entities that were purged: every event about them goes. */
  entities?: ReadonlyArray<{ type: string; id: string }>;
  /** A person (usr_ id, or any actor id): what they wrote, what was written for them, and events about them as an entity. */
  person?: string;
  /** Text that names the subject in payloads: id, email, phone, name. Matched as plain substrings of the payload text. */
  identifiers?: readonly string[];
}

export interface CompactOptions {
  /** The log's own database handle: with it the file is scrubbed too (secure_delete, WAL checkpoint, VACUUM) and the tombstone is recorded. */
  db?: DatabaseSync;
  now?: () => number;
  /** Default true. Turn off only where the log is too big to vacuum in this call. */
  vacuum?: boolean;
}

export interface CompactResult {
  /** The events whose payload this call erased. */
  erased: number[];
  /** Matching events that were already erased. */
  already: number;
}

const TOMBSTONE = '{"erased":true}';
const PAGE = 5000;
const decode = new TextDecoder();

/** Is this event's payload the tombstone? Projection folds call this and skip the event. */
export function isErased(e: Pick<StoredEvent, "payload">): boolean {
  return decode.decode(e.payload) === TOMBSTONE;
}

/** The key the tombstone row and a restore use for this subject. */
export function subjectKey(s: CompactSubject): string {
  const parts: string[] = [];
  if (s.person) parts.push(`person:${s.person}`);
  for (const e of s.entities ?? []) parts.push(`${e.type}:${e.id}`);
  for (const i of s.identifiers ?? []) parts.push(`text:${i}`);
  return parts.sort().join("|");
}

function matcher(s: CompactSubject): (e: StoredEvent) => boolean {
  const entities = new Set((s.entities ?? []).map((x) => `${x.type}\u0000${x.id}`));
  // payloads are canonical JSON, where quotes, backslashes and non-ASCII may be escaped: look for both spellings of each identifier
  const needles = (s.identifiers ?? []).filter((x) => x.length > 0).flatMap((x) => {
    const escaped = JSON.stringify(x).slice(1, -1);
    return escaped === x ? [x] : [x, escaped];
  });
  const person = s.person;
  return (e) => {
    if (e.entity !== undefined && e.entity_id !== undefined && entities.has(`${e.entity}\u0000${e.entity_id}`)) return true;
    if (person !== undefined && (e.actor === person || e.on_behalf === person || e.entity_id === person)) return true;
    if (needles.length > 0) {
      const text = decode.decode(e.payload);
      if (needles.some((n) => text.includes(n))) return true;
    }
    return false;
  };
}

export async function compact(port: CompactPort, subject: CompactSubject, o: CompactOptions = {}): Promise<CompactResult> {
  const key = subjectKey(subject);
  if (key === "") throw new Error("name what to erase: an entity, a person or some text");
  if (o.db) o.db.exec("PRAGMA secure_delete = ON");
  const hit = matcher(subject);
  const erased: number[] = [];
  let already = 0;
  for (let after = 0; ; ) {
    const page = await port.read({ after, limit: PAGE });
    if (page.length === 0) break;
    for (const e of page) {
      if (!hit(e)) continue;
      if (isErased(e)) { already++; continue; }
      if (await port.erase(e.seq)) erased.push(e.seq);
    }
    after = page[page.length - 1]!.seq;
    if (page.length < PAGE) break;
  }
  if (o.db) {
    o.db.prepare("INSERT OR IGNORE INTO tombstones (kind, subject, at) VALUES (?, ?, ?)").run("events", key, (o.now ?? Date.now)());
    o.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    if (o.vacuum !== false) o.db.exec("VACUUM");
    o.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  return { erased, already };
}
