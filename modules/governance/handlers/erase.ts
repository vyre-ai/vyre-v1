// Erase a person's data (spec 2.26; ARCH 4.11): find everything about one contact, show it, erase what was chosen, and keep tombstones a restore replays so erased data never comes back.
// DECISION: find looks in the places that have a way to ask: the contact's records (contacts.resolve, records.get), files and chats and inbox text by name, email and number (search.query), the conversation
// (inbox.thread: mail, texts and calls), and memory (memory.find_by_subject). A finding keeps item ids only, for 24 hours; the answer shows counts and up to five titles per kind, never more than the
// asker could already see.
// DECISION: erase uses the erasers that exist: records (records.delete), files (files.delete then files.purge) and memory facts (memory.erase). Chats, inbox, mail, calls and runs have no eraser capability in the
// frozen contract yet; they stay in the finding, the Run says which kinds were left, and the next backup rotation purges what a restore would bring. That is a contract gap for the steward (reported on the packet).
// DECISION: a hold on the person, on a file, a folder above it, or on a record stops the erase with permission.on_hold, counting what is held and never naming it. Overriding takes a reason and the Owner role
// (Admin is not enough), and the reason goes in the audit event. Erasing does not release the hold.
// DECISION: one tombstone is written per erased item (kind, the item's type and id, time, who); replaying them is the same erasers, idempotent, so a restore that brought data back erases it again before the
// Space opens (tombstones.reapply, called by backup.restore's host seam). The audit events say who and when and how many, never what.
// DECISION (P-CC_41): erase reaches the event log. After the erasers, one compaction (kernel/src/events/compact.ts, through the events port the host binds) turns the payloads of every event about the erased
// items, or naming the person's name, email or phone, into tombstones, and a governance_tombstone row of kind "events" keeps the seqs it erased (never text). A restore that brings an older events.db back replays
// those seqs, so the payloads leave again. Without the port (a host with no log) the log is left alone.
import { fail } from "../../../host/src/routes/errors.ts";
import { ERASE_KINDS, bad, codeOf, ensure, finishRun, first, holdRow, isId, list, newId, num, obj, pageOf, paging, parseJson, refuse, rowsOf, startRun, str, text } from "../projections.ts";
import type { EraseKind, GovCtx, Json, Row } from "../projections.ts";
import { eraseItem } from "./erasers.ts";
import { isHostService } from "../../../lib/trust.ts";
import type { Outcome } from "./erasers.ts";
import { fileHeld } from "./retention.ts";

const DAY = 86_400_000;

/** A finder that answers not found has nothing of its kind about this person: that is an answer, not a failure of the find. Any other refusal still stops it. */
async function finder(run: () => Promise<unknown>, nothing: Json): Promise<Json> {
  try { return obj(await run()); } catch (e) { if (codeOf(e) === "validation.not_found") return nothing; throw e; }
}
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const PHONE = /^\+[1-9][0-9]{6,14}$/;

interface Item { type: string; id: string; title: string }
type Items = Partial<Record<EraseKind, Item[]>>;

// ---- find

function subjectOf(ctx: GovCtx, raw: unknown): { recordId?: string; email?: string; phone?: string; name?: string } {
  const s = obj(raw);
  const out: { recordId?: string; email?: string; phone?: string; name?: string } = {};
  if (s["recordId"] !== undefined) { if (!isId("rec", s["recordId"])) bad(ctx, "The record id is not valid."); out.recordId = s["recordId"] as string; }
  if (s["email"] !== undefined) { if (typeof s["email"] !== "string" || !EMAIL.test(s["email"])) bad(ctx, "The email is not valid."); out.email = (s["email"] as string).toLowerCase(); }
  if (s["phone"] !== undefined) { if (typeof s["phone"] !== "string" || !PHONE.test(s["phone"])) bad(ctx, "The phone number needs its country code, like +14155550123."); out.phone = s["phone"] as string; }
  if (s["name"] !== undefined) { if (typeof s["name"] !== "string" || s["name"].trim().length < 2 || s["name"].length > 200) bad(ctx, "The name is 2 to 200 characters."); out.name = (s["name"] as string).trim(); }
  if (Object.keys(out).length === 0) bad(ctx, "Give a record, an email, a phone number or a name to look for.");
  return out;
}

function add(items: Items, kind: EraseKind, it: Item): void {
  const have = items[kind] ?? [];
  if (!have.some((x) => x.type === it.type && x.id === it.id)) have.push(it);
  items[kind] = have;
}

async function recordsOf(ctx: GovCtx, s: ReturnType<typeof subjectOf>): Promise<{ type: string; id: string }[]> {
  const found: { type: string; id: string }[] = [];
  const push = (type: string, id: string): void => { if (!found.some((f) => f.id === id)) found.push({ type, id }); };
  if (s.recordId) {
    for (const type of ["contact", "company"]) {
      try {
        await ctx.call("records.get", { type, recordId: s.recordId });
        push(type, s.recordId);
        break;
      } catch (e) {
        if (codeOf(e) !== "validation.not_found") throw e;
      }
    }
  }
  for (const probe of [s.email ? { email: s.email } : null, s.phone ? { phone: s.phone } : null, s.name ? { name: s.name } : null]) {
    if (!probe) continue;
    for (const c of list((await finder(() => ctx.call("contacts.resolve", probe), { sure: [], unsure: [] }))["sure"]).map(obj)) push(text(c["type"]) || "contact", text(c["recordId"]));
  }
  return found;
}

export async function eraseFind(ctx: GovCtx, input: { subject: unknown }) {
  ensure(ctx);
  const s = subjectOf(ctx, input.subject);
  const now = ctx.now();
  for (const old of rowsOf(ctx.db.all(`SELECT * FROM governance_finding`))) if (num(old, "expiresAt") <= now) ctx.db.run(`DELETE FROM governance_finding WHERE "id" = ?`, str(old, "id"));
  const items: Items = {};
  const recs = await recordsOf(ctx, s);
  for (const r of recs) {
    let title = r.id;
    try { title = text(obj(obj(obj(await ctx.call("records.get", { type: r.type, recordId: r.id }))["record"])["fields"])["name"]) || r.id; } catch { /* a title that cannot be read is the id */ }
    add(items, "records", { type: r.type, id: r.id, title });
  }
  const terms = [s.email, s.phone, s.name, ...recs.map((r) => r.id)].filter((x): x is string => typeof x === "string");

  // files, chats, inbox text: the search the caller already has
  for (const term of terms.filter((t) => !isId("rec", t))) {
    const hits = list((await finder(() => ctx.call("search.query", { q: term, types: ["file", "chat", "channel", "inbox"], limit: 100 }), { hits: [] }))["hits"]).map(obj);
    for (const h of hits) {
      const kind = text(h["kind"]);
      const it = { type: kind, id: text(h["id"]), title: text(h["title"]) || text(h["id"]) };
      if (kind === "file") add(items, "files", it);
      else if (kind === "chat" || kind === "channel") add(items, "chats", it);
      else if (kind === "inbox") add(items, "inbox", it);
    }
  }
  // the conversation: mail, texts and calls
  for (const r of recs) {
    let before: number | undefined;
    for (let pages = 0; pages < 20; pages++) {
      const t = await finder(() => ctx.call("inbox.thread", { contactId: r.id, limit: 200, ...(before !== undefined ? { before } : {}) }), { items: [] });   // a contact nobody has written to yet has no thread
      const rows = list(t["items"]).map(obj);
      for (const it of rows) {
        const kind = text(it["kind"]);
        const target: EraseKind | null = kind === "email" ? "mail" : kind === "sms" ? "inbox" : kind === "call" ? "calls" : null;
        if (target) add(items, target, { type: kind, id: text(it["id"]), title: `${kind} ${text(it["id"])}` });
      }
      const oldest = rows.reduce<number | null>((m, it) => (typeof it["at"] === "number" ? (m === null ? it["at"] : Math.min(m, it["at"])) : m), null);
      if (rows.length < 200 || oldest === null) break;
      before = oldest;
    }
  }
  // memory: facts and notes about the subject
  for (const subject of [...recs.map((r) => r.id), ...(s.email ? [s.email] : [])]) {
    const m = await finder(() => ctx.call("memory.find_by_subject", { subject, limit: 500 }), { facts: [], notes: [] });
    for (const f of list(m["facts"]).map(obj)) add(items, "memory", { type: "fact", id: text(f["factId"]), title: `fact ${text(f["factId"])}` });
    for (const n of list(m["notes"]).map(obj)) add(items, "memory", { type: "note", id: text(n["noteId"]), title: text(n["title"]) || text(n["noteId"]) });
  }

  const id = newId("fnd", now);
  const expiresAt = now + DAY;
  ctx.db.run(`INSERT INTO governance_finding ("id", "by", "at", "expiresAt", "recordIds", "items") VALUES (?, ?, ?, ?, ?, ?)`, id, ctx.principal.id, now, expiresAt, JSON.stringify(recs.map((r) => r.id)), JSON.stringify(idsOnly(items)));
  const groups = [];
  for (const kind of ERASE_KINDS) {
    const its = items[kind] ?? [];
    let onHold = 0;
    for (const it of its) if (await held(ctx, kind, it, recs.map((r) => r.id))) onHold++;
    groups.push({ kind, count: its.length, onHold, samples: its.slice(0, 5).map((x) => ({ type: x.type, id: x.id, title: x.title })) });
  }
  return { findingId: id, groups, expiresAt };
}

/** Is this item under a hold: the item itself, its folder, its owner, or the person the finding is about. */
async function held(ctx: GovCtx, kind: EraseKind, it: Item, people: string[]): Promise<boolean> {
  if (people.some((p) => holdRow(ctx, "person", p))) return true;
  if (kind === "files" && it.type === "file") return fileHeld(ctx, it.id);
  if (kind === "records") {
    if (holdRow(ctx, "person", it.id)) return true;
    try { return num(obj(obj(await ctx.call("records.get", { type: it.type, recordId: it.id }))["record"]) as Row, "holds") > 0; } catch (e) { if (codeOf(e) === "validation.not_found") return false; throw e; }
  }
  if (kind === "chats") return holdRow(ctx, it.type === "channel" ? "channel" : "thread", it.id) !== null;
  return false;
}

/** What a finding keeps: kinds, item types and ids. Titles are shown once, in the answer to find, and not stored. */
function idsOnly(items: Items): Items {
  return Object.fromEntries(Object.entries(items).map(([k, v]) => [k, (v ?? []).map((x) => ({ type: x.type, id: x.id, title: "" }))])) as Items;
}

// ---- erasers (also what a restore replays)

/** The event log as governance needs it (host/src/daemon wires the LogClient behind it). */
export interface EventsCompactPort {
  compact(subject: { entities?: ReadonlyArray<{ type?: string; id: string }>; person?: string; identifiers?: readonly string[] }): Promise<{ erased: number[]; already: number }>;
  compactSeqs(seqs: readonly number[]): Promise<{ erased: number[]; already: number }>;
}
let eventsPort: EventsCompactPort | null = null;
export function setEventsCompact(p: EventsCompactPort | null): void { eventsPort = p; }

/** Text that names the person in payloads: the name, email and phone of their records. Read before the records go. A record that cannot be read adds nothing. */
async function identifiersOf(ctx: GovCtx, records: readonly { type: string; id: string }[]): Promise<string[]> {
  const out = new Set<string>();
  for (const r of records) {
    try {
      const fields = obj(obj(obj(await ctx.call("records.get", { type: r.type, recordId: r.id }))["record"])["fields"]);
      for (const k of ["name", "title", "email", "phone"]) { const v = fields[k]; if (typeof v === "string" && v.trim().length >= 3) out.add(v.trim()); }
    } catch { /* gone already, or unreadable: its id still leads the compaction */ }
  }
  return [...out];
}

/** Erase one item through the eraser of its store (erasers.ts). `gone` counts as erased: the erase is done. `no_eraser` removes nothing. */
async function eraseOne(ctx: GovCtx, kind: EraseKind, subjectType: string, subjectId: string, reason: string): Promise<Outcome> {
  return eraseItem(ctx, kind, subjectType, subjectId, reason);
}

async function ownerRole(ctx: GovCtx): Promise<boolean> {
  const p = obj(obj(await ctx.call("access.principals.get", { principal: { kind: ctx.principal.kind, id: ctx.principal.id } }))["principal"]);
  return list(p["roles"]).includes("rol_owner");
}

export async function eraseApply(ctx: GovCtx, input: { findingId: string; include: string[]; overrideHold?: { reason: string }; idempotencyKey: string }) {
  ensure(ctx);
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey === "") bad(ctx, "An idempotency key is required.");
  if (!isId("fnd", input.findingId)) bad(ctx, "The finding id is not valid.");
  const done = first(ctx.db.all(`SELECT * FROM governance_erase WHERE "findingId" = ?`, input.findingId));
  if (done) return { runId: str(done, "runId") };   // the same finding again: already erased
  const f = first(ctx.db.all(`SELECT * FROM governance_finding WHERE "id" = ?`, input.findingId));
  if (!f || num(f, "expiresAt") <= ctx.now()) return refuse(ctx, "That finding is gone or older than 24 hours. Look for the person again.");
  if (!Array.isArray(input.include) || input.include.length === 0 || input.include.some((k) => !(ERASE_KINDS as readonly string[]).includes(k))) bad(ctx, "Say which kinds to erase.");
  const kinds = [...new Set(input.include)] as EraseKind[];
  const items = parseJson<Items>(f["items"], {});
  const people = parseJson<string[]>(f["recordIds"], []);

  let heldCount = 0;
  for (const kind of kinds) for (const it of items[kind] ?? []) if (await held(ctx, kind, it, people)) heldCount++;
  const override = input.overrideHold;
  if (heldCount > 0) {
    if (!override) throw fail("permission.on_hold", ctx.trace.traceId, { message: `${heldCount} item${heldCount === 1 ? " is" : "s are"} on hold. Release the hold, or an Owner can override it with a reason.`, details: { held: heldCount } });
    if (typeof override.reason !== "string" || override.reason.trim() === "") bad(ctx, "Overriding a hold needs a reason.");
    if (!(await ownerRole(ctx))) throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only the Owner can erase something that is on hold." });
  } else if (override !== undefined && (typeof override.reason !== "string" || override.reason.trim() === "")) bad(ctx, "Overriding a hold needs a reason.");

  const runId = await startRun(ctx, "Erase a person's data", `erase:${input.findingId}:${input.idempotencyKey}`);
  ctx.emit("erase.started", `entity/${input.findingId}`, { findingId: input.findingId, by: ctx.principal.id, overrodeHold: heldCount > 0 });
  const reason = heldCount > 0 ? `Erase a person (hold overridden: ${(override as { reason: string }).reason.trim().slice(0, 200)})` : "Erase a person";
  let tombstones = 0;
  const left: string[] = [];
  let trashed = 0;
  // read before the erasers run: once a record is deleted its name, email and phone cannot be asked for
  const identifiers = eventsPort ? await identifiersOf(ctx, items.records ?? []) : [];
  const removed: string[] = [];
  try {
    for (const kind of kinds) {
      const its = items[kind] ?? [];
      if (its.length === 0) continue;
      let noEraser = 0;
      for (const it of its) {
        const outcome = await eraseOne(ctx, kind, it.type, it.id, reason);
        if (outcome === "no_eraser") { noEraser++; continue; }   // nothing was removed: no tombstone, and the Run says so
        if (outcome !== "trashed") removed.push(it.id);   // an item still in Trash is not gone, so its events keep their payloads (a restore from Trash needs them)
        if (outcome === "trashed") trashed++;   // out of every view, still in Trash: a tombstone, so a restore takes it out again, and the Run says it is not a hard delete
        ctx.db.run(`INSERT INTO governance_tombstone ("id", "kind", "subjectType", "subjectId", "at", "by", "findingId") VALUES (?, ?, ?, ?, ?, ?, ?)`, newId("tmb", ctx.now()), kind, it.type, it.id, ctx.now(), ctx.principal.id, input.findingId);
        tombstones++;
      }
      if (noEraser > 0) left.push(`${kind} (${noEraser})`);
    }
  } catch (e) {
    await finishRun(ctx, runId, { code: codeOf(e) || "internal.unexpected", message: (e as { error?: { message?: string } } | null)?.error?.message ?? "The erase did not finish." });
    throw e;
  }
  // the log: everything about the erased items and the person's text goes, and the seqs are remembered for a restore
  if (eventsPort) {
    const subject = { entities: [...removed, ...people].map((id) => ({ id })), identifiers };
    if (subject.entities.length > 0 || identifiers.length > 0) {
      const out = await eventsPort.compact(subject);
      if (out.erased.length > 0) {
        ctx.db.run(`INSERT INTO governance_tombstone ("id", "kind", "subjectType", "subjectId", "at", "by", "findingId") VALUES (?, ?, ?, ?, ?, ?, ?)`, newId("tmb", ctx.now()), "events", "seqs", JSON.stringify(out.erased), ctx.now(), ctx.principal.id, input.findingId);
        tombstones++;
      }
    }
  }
  ctx.db.run(`INSERT INTO governance_erase ("findingId", "by", "at", "kinds", "tombstones", "runId") VALUES (?, ?, ?, ?, ?, ?)`, input.findingId, ctx.principal.id, ctx.now(), JSON.stringify(kinds), tombstones, runId);
  ctx.emit("erase.completed", `entity/${input.findingId}`, { findingId: input.findingId, tombstones });
  await finishRun(ctx, runId, { summary: `${tombstones} erased${left.length ? `; no eraser yet for ${left.join(", ")}, which the next backup rotation purges` : ""}${trashed ? `; ${trashed} record${trashed === 1 ? "" : "s"} moved to Trash, not hard-deleted yet` : ""}` });
  return { runId };
}

export async function eraseList(ctx: GovCtx, input: { cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  const rows = rowsOf(ctx.db.all(`SELECT * FROM governance_erase`)).sort((a, b) => num(b, "at") - num(a, "at") || str(a, "findingId").localeCompare(str(b, "findingId")));
  const p = pageOf(rows, cursor, limit);
  return { erasures: p.page.map((r) => ({ findingId: str(r, "findingId"), by: str(r, "by"), at: num(r, "at"), kinds: parseJson<string[]>(r["kinds"], []), tombstones: num(r, "tombstones") })), ...(p.next ? { next: p.next } : {}), total: p.total };
}

// ---- tombstones

export async function tombstonesList(ctx: GovCtx, input: { cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  const rows = rowsOf(ctx.db.all(`SELECT * FROM governance_tombstone`)).sort((a, b) => num(b, "at") - num(a, "at") || str(a, "id").localeCompare(str(b, "id")));
  const p = pageOf(rows, cursor, limit);
  return { tombstones: p.page.map((r) => ({ id: str(r, "id"), kind: str(r, "kind"), at: num(r, "at"), by: str(r, "by") })), ...(p.next ? { next: p.next } : {}), total: p.total };
}

/** After a restore: every tombstone erased again, in the order they were written, before the Space opens for traffic. Idempotent. */
export async function tombstonesReapply(ctx: GovCtx, input: { tombstones?: Array<{ id: string; kind: string; subjectType: string; subjectId: string; at: number; by: string; findingId?: string }> } = {}) {
  ensure(ctx);
  // Only the host replays tombstones, as itself, at start. The list it brings is erased from the Space, so nobody else may name one, the owner included (P-GF_11).
  if (!isHostService(ctx.principal)) throw fail("permission.role_lacks_permission", ctx.trace.traceId, { message: "Only the server replays tombstones.", details: { reason: "system_only" } });
  // the erasures made after the backup was taken: the restored database has not heard of them, so the host brings them over and they are kept like any other
  for (const t of input.tombstones ?? []) {
    ctx.db.run(`INSERT OR IGNORE INTO governance_tombstone ("id", "kind", "subjectType", "subjectId", "at", "by", "findingId") VALUES (?, ?, ?, ?, ?, ?, ?)`, t.id, t.kind, t.subjectType, t.subjectId, t.at, t.by, t.findingId ?? "");
  }
  const rows = rowsOf(ctx.db.all(`SELECT * FROM governance_tombstone`)).sort((a, b) => num(a, "at") - num(b, "at") || str(a, "id").localeCompare(str(b, "id")));
  for (const r of rows) {
    if (str(r, "kind") === "events") {
      // an older events.db came back with its payloads: erase the same events again, by the seqs the tombstone kept
      const seqs = parseJson<number[]>(r["subjectId"], []).filter((n) => Number.isInteger(n));
      if (eventsPort && seqs.length > 0) await eventsPort.compactSeqs(seqs);
      continue;
    }
    await eraseOne(ctx, str(r, "kind") as EraseKind, str(r, "subjectType"), str(r, "subjectId"), "Tombstone replayed after a restore");   // a store whose eraser is gone from the contract is skipped here, not failed
  }
  ctx.emit("tombstones.reapplied", `entity/${rows.length}`, { count: rows.length });
  return { count: rows.length };
}

