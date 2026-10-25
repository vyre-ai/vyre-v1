// inbox.link_message, inbox.match, inbox.unmatch, inbox.match_new, inbox.match_suggestions, inbox.mark_read, inbox.follow_set (spec 2.18 Matching and Following; 3.3 flow 2).
//
// Every stored message, text and call is linked here once. A SURE match (an address a contact or company holds) puts it in that record's conversation; an UNSURE one is
// kept apart and raises Needs a match (a Needs you task, once); a stranger stays in the Unmatched list unless we wrote to them first, in which case their reply raises
// Needs a match too ("only senders with prior outbound contact ... raise it"). A person's match moves the whole history of the sender into the record's conversation and
// stays undoable: Undo gives the history back to the sender. Nothing is ever deleted, only folded (the sender's row is hidden) and restored.
// DECISION: a match remembers the sender's address on the record (contacts.address.add) unless the caller says rememberAddress false; Undo takes it back off again.
// DECISION: the Needs you task is assigned to the person route_owner names, else to the admin role; closing it when the sender is matched is the task module's job.
import { newId, bad, ensure, findRecord, first, followOf, getConversation, isId, kindOfAddress, list, missing, nameOf, nextVersion, normAddress, num, obj, refuse, rowsOf, str, strOrNull, text, toConversation, toJson, codeOf } from "../projections.ts";
import type { Channel, ConversationRow, InboxCtx, Json, RecordLite, Row } from "../projections.ts";

const REF_KIND: Record<Channel, string> = { email: "mail_message", sms: "sms", call: "call" };
const CHUNK = 400;

export interface Candidate {
  recordId: string;
  type: "contact" | "company";
  name: string;
  via: "address" | "phone" | "handle" | "name";
  score: number;
}
export interface Suggestion {
  recordId: string;
  type: "contact" | "company";
  name: string;
  score: number;
  why: string;
}

const WHY: Record<Candidate["via"], string> = { address: "Same email address", phone: "Same phone number", handle: "Same handle", name: "Similar name" };

// ---- reading the sender's candidates

/** Sure and unsure records for an address (and a name, when it is more than the address). Bad input from the matcher (a number it cannot read) means no candidates. */
export async function candidatesFor(ctx: InboxCtx, address: string, name?: string): Promise<{ sure: Candidate[]; unsure: Candidate[] }> {
  const kind = kindOfAddress(address);
  const q: Json = kind === "email" ? { email: address } : kind === "phone" ? { phone: address } : { handle: address };
  if (name && name !== address && name.length <= 200) q.name = name;
  let res: Json;
  try {
    res = obj(await ctx.call("contacts.resolve", q));
  } catch (e) {
    if (codeOf(e) === "validation.bad_input") return { sure: [], unsure: [] };
    throw e;
  }
  const read = (v: unknown): Candidate[] => list(v).map((c) => {
    const o = obj(c);
    return { recordId: text(o.recordId), type: o.type === "company" ? "company" : "contact", name: text(o.name), via: (["address", "phone", "handle", "name"].includes(text(o.via)) ? text(o.via) : "address") as Candidate["via"], score: typeof o.score === "number" ? o.score : 0 } satisfies Candidate;
  }).filter((c) => c.recordId !== "").sort((a, b) => b.score - a.score);
  return { sure: read(res.sure), unsure: read(res.unsure) };
}

/** Who gets an unowned reply: the contact owner, then the campaign owner, then the shared inbox's owner. Never blocks linking. */
async function ownerFor(ctx: InboxCtx, a: { contactId?: string | null | undefined; campaignId?: string | null | undefined; mailboxId?: string | undefined }): Promise<string | null> {
  const q: Json = {};
  if (a.contactId) q.contactId = a.contactId;
  if (a.campaignId) q.campaignId = a.campaignId;
  if (a.mailboxId) q.mailboxId = a.mailboxId;
  try {
    const owner = text(obj(await ctx.call("contacts.route_owner", q)).ownerId);
    return owner || null;
  } catch (e) {
    ctx.log.warn("inbox: could not route the owner", { code: codeOf(e) });
    return null;
  }
}

// ---- keeping a conversation up to date from its items

/** Recompute the last message, unread count and inboxes of a conversation from the items it holds. A conversation with no items keeps what it has. */
export function refresh(ctx: InboxCtx, id: string): void {
  const conv = getConversation(ctx, id);
  if (!conv) return;
  const items = rowsOf(ctx.db.all(`SELECT * FROM inbox_item WHERE "conversationId" = ? ORDER BY "at" DESC`, id));
  const latest = items[0];
  if (!latest) return;
  const mailboxIds = items.map((i) => strOrNull(i, "mailboxId")).filter((v): v is string => v !== null);
  const numberIds = items.map((i) => strOrNull(i, "numberId")).filter((v): v is string => v !== null);
  const campaign = strOrNull(conv, "campaignId") ?? items.map((i) => strOrNull(i, "campaignId")).find((v) => v !== null) ?? null;
  ctx.db.run(
    `UPDATE inbox_conversation SET "lastMessageAt" = ?, "lastChannel" = ?, "lastPreview" = ?, "unreadCount" = ?, "mailboxIds" = ?, "numberIds" = ?, "campaignId" = ?, version = ?, updated_at = ? WHERE id = ?`,
    num(latest, "at"), str(latest, "kind"), str(latest, "preview"), items.filter((i) => num(i, "unread") === 1).length, toJson(mailboxIds), toJson(numberIds), campaign,
    nextVersion(conv), ctx.now(), id,
  );
}

function moveItems(ctx: InboxCtx, ids: string[], to: string): void {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    ctx.db.run(`UPDATE inbox_item SET "conversationId" = ? WHERE id IN (${part.map(() => "?").join(", ")})`, to, ...part);
  }
}

function itemIdsOf(ctx: InboxCtx, conversationId: string): string[] {
  return rowsOf(ctx.db.all(`SELECT id FROM inbox_item WHERE "conversationId" = ?`, conversationId)).map((r) => str(r, "id"));
}

function insertConversation(ctx: InboxCtx, c: { contactId: string | null; address: string; displayName: string; at: number; channel: Channel; preview: string; needsMatch: boolean; ownerId: string | null; campaignId: string | null }): Row {
  const id = newId("cnv", ctx.now());
  ctx.db.run(
    `INSERT INTO inbox_conversation (id, "contactId", address, "displayName", "lastMessageAt", "lastChannel", "lastPreview", "unreadCount", "needsMatch", "ownerId", "mailboxIds", "numberIds", "campaignId", version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, c.contactId, c.address, c.displayName, c.at, c.channel, c.preview, 0, c.needsMatch ? 1 : 0, c.ownerId, "[]", "[]", c.campaignId, 1, ctx.now(), null,
  );
  return getConversation(ctx, id) as Row;
}

// ---- attach a sender's conversation to a record (a match), and take it back

const byOf = (ctx: InboxCtx): "person" | "agent" => (ctx.principal.kind === "agent" ? "agent" : "person");

/** Link a sender's conversation to a record: the conversation takes the record, or, when the record already has one, folds into it. Returns the surviving conversation and the Undo token. */
async function attach(ctx: InboxCtx, source: Row, rec: RecordLite, by: "rule" | "person" | "agent", addedAddressId?: string): Promise<{ conversation: Row; token: string }> {
  const sourceId = str(source, "id");
  const token = newId("und", ctx.now());
  const target = first(ctx.db.all(`SELECT * FROM inbox_conversation WHERE "contactId" = ? AND deleted_at IS NULL`, rec.id));
  const itemIds = itemIdsOf(ctx, sourceId);
  let survivor: string;
  if (target) {
    survivor = str(target, "id");
    moveItems(ctx, itemIds, survivor);
    ctx.db.run(`UPDATE inbox_conversation SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, ctx.now(), nextVersion(source), ctx.now(), sourceId);
    refresh(ctx, survivor);
    ctx.db.run(
      `INSERT INTO inbox_undo (token, mode, "sourceId", "targetId", "recordId", snapshot, "itemIds", at, undone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      token, "merge", sourceId, survivor, rec.id, JSON.stringify({ addedAddressId: addedAddressId ?? null }), JSON.stringify(itemIds), ctx.now(), 0,
    );
  } else {
    survivor = sourceId;
    const owner = strOrNull(source, "ownerId") ?? (await ownerFor(ctx, { contactId: rec.id, campaignId: strOrNull(source, "campaignId") }));
    ctx.db.run(
      `UPDATE inbox_conversation SET "contactId" = ?, "displayName" = ?, "needsMatch" = ?, "ownerId" = ?, version = ?, updated_at = ? WHERE id = ?`,
      rec.id, nameOf(rec), 0, owner, nextVersion(source), ctx.now(), sourceId,
    );
    ctx.db.run(
      `INSERT INTO inbox_undo (token, mode, "sourceId", "targetId", "recordId", snapshot, "itemIds", at, undone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      token, "rename", sourceId, sourceId, rec.id,
      JSON.stringify({ displayName: str(source, "displayName"), needsMatch: num(source, "needsMatch"), ownerId: strOrNull(source, "ownerId"), addedAddressId: addedAddressId ?? null }), JSON.stringify(itemIds), ctx.now(), 0,
    );
  }
  ctx.emit("conversation.matched", `record/${rec.id}`, { conversationId: survivor, recordId: rec.id, by, undoable: true });
  return { conversation: getConversation(ctx, survivor) as Row, token };
}

// ---- inbox.link_message

export interface LinkIn {
  channel: Channel;
  ref: { kind: "mail_message" | "sms" | "call"; id: string };
  address: string;
  direction: "in" | "out";
  at: number;
  mailboxId?: string;
  numberId?: string;
  campaignId?: string;
  preview?: string;
}

/** The thread, subject and people of an email, from mail. A message mail will not show (private to another inbox) still gets a thread of its own. */
async function emailFacts(ctx: InboxCtx, id: string, address: string): Promise<{ threadId: string; subject: string; participants: string[] }> {
  try {
    const m = obj(obj(await ctx.call("mail.message.get", { messageId: id })).message);
    const people = [obj(m.from), ...list(m.to).map(obj), ...list(m.cc).map(obj)].map((p) => text(p.address).toLowerCase()).filter(Boolean);
    return { threadId: text(m.threadId) || `mail:${id}`, subject: text(m.subject), participants: people.length ? people : [address] };
  } catch (e) {
    ctx.log.warn("inbox: could not read the message for its thread", { code: codeOf(e) });
    return { threadId: `mail:${id}`, subject: "", participants: [address] };
  }
}

export async function linkMessage(
  ctx: InboxCtx, input: LinkIn,
): Promise<{ conversationId: string; contactId?: string; linked: "sure" | "unsure" | "none"; taskId?: string }> {
  ensure(ctx);
  if (!["email", "sms", "call"].includes(input.channel)) bad(ctx, "The channel is email, sms or call.");
  if (input.ref?.kind !== REF_KIND[input.channel] || typeof input.ref.id !== "string" || input.ref.id === "") bad(ctx, `A ${input.channel} is linked by its ${REF_KIND[input.channel]} reference.`);
  if (input.direction !== "in" && input.direction !== "out") bad(ctx, "The direction is in or out.");
  if (!Number.isSafeInteger(input.at) || input.at < 0) bad(ctx, "The time must be milliseconds since the epoch.");
  const address = typeof input.address === "string" ? normAddress(input.address) : "";
  if (!address) bad(ctx, "An address, number or handle is needed to link a message.");

  const itemId = `${input.ref.kind}:${input.ref.id}`;
  const seen = first(ctx.db.all(`SELECT "conversationId" FROM inbox_item WHERE id = ?`, itemId));
  if (seen) {
    const id = str(seen, "conversationId");   // linked before: natural idempotency; a Needs you task that failed to raise is raised now
    return answer(ctx, getConversation(ctx, id) as Row, await ensureTask(ctx, id));
  }

  // who is it?
  const found = await candidatesFor(ctx, address);
  const sure = found.sure[0];
  const unsure = found.unsure.length > 0;

  // which conversation does it belong to?
  let conv: Row | null;
  let created = false;
  let ruleMatched: RecordLite | null = null;
  const ofAddress = first(ctx.db.all(`SELECT * FROM inbox_conversation WHERE address = ? AND "contactId" IS NULL AND deleted_at IS NULL`, address));
  if (sure) {
    conv = first(ctx.db.all(`SELECT * FROM inbox_conversation WHERE "contactId" = ? AND deleted_at IS NULL`, sure.recordId));
    if (!conv) {
      if (ofAddress) {
        conv = ofAddress;
        ruleMatched = { id: sure.recordId, type: sure.type, fields: { name: sure.name } };
      } else {
        const owner = await ownerFor(ctx, { contactId: sure.recordId, campaignId: input.campaignId, mailboxId: input.mailboxId });
        conv = insertConversation(ctx, {
          contactId: sure.recordId, address, displayName: sure.name || address, at: input.at, channel: input.channel, preview: input.preview ?? "", needsMatch: false, ownerId: owner,
          campaignId: input.campaignId ?? null,
        });
        created = true;
      }
    } else if (ofAddress) {
      // the sender used to be a stranger and is now a known address: fold the old rows into the contact's conversation
      ruleMatched = { id: sure.recordId, type: sure.type, fields: { name: sure.name } };
      conv = ofAddress;
    }
  } else {
    conv = ofAddress;
    if (!conv) {
      conv = insertConversation(ctx, {
        contactId: null, address, displayName: address, at: input.at, channel: input.channel, preview: input.preview ?? "", needsMatch: false, ownerId: await ownerFor(ctx, { campaignId: input.campaignId, mailboxId: input.mailboxId }),
        campaignId: input.campaignId ?? null,
      });
      created = true;
    }
  }
  let id = str(conv, "id");
  if (created) {
    ctx.emit("conversation.created", `entity/${id}`, { conversationId: id, ...(sure ? { contactId: sure.recordId } : {}), channel: input.channel });
    if (sure) ctx.emit("conversation.matched", `record/${sure.recordId}`, { conversationId: id, recordId: sure.recordId, by: "rule", undoable: false });
  }

  // the item
  const facts = input.channel === "email"
    ? await emailFacts(ctx, input.ref.id, address)
    : { threadId: `${input.channel}:${input.numberId ?? "-"}:${address}`, subject: "", participants: [address] };
  const priorOut = first(ctx.db.all(`SELECT id FROM inbox_item WHERE "conversationId" = ? AND direction = ?`, id, "out")) !== null;
  ctx.db.run(
    `INSERT INTO inbox_item (id, "conversationId", kind, "refId", address, direction, at, "mailboxId", "numberId", "campaignId", "threadId", subject, preview, participants, unread)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    itemId, id, input.channel, input.ref.id, address, input.direction, input.at, input.mailboxId ?? null, input.numberId ?? null, input.campaignId ?? null, facts.threadId, facts.subject,
    input.preview ?? facts.subject, JSON.stringify(facts.participants), input.direction === "in" ? 1 : 0,
  );

  if (ruleMatched) {
    const folded = await attach(ctx, conv as Row, ruleMatched, "rule");
    id = str(folded.conversation, "id");
  }
  refresh(ctx, id);
  conv = getConversation(ctx, id) as Row;

  // an unowned conversation goes to the right person
  if (!strOrNull(conv, "ownerId")) {
    const owner = await ownerFor(ctx, { contactId: strOrNull(conv, "contactId"), campaignId: input.campaignId ?? strOrNull(conv, "campaignId"), mailboxId: input.mailboxId });
    if (owner) ctx.db.run(`UPDATE inbox_conversation SET "ownerId" = ?, version = ?, updated_at = ? WHERE id = ?`, owner, nextVersion(conv), ctx.now(), id);
  }

  // Needs a match: an unsure sender, or a stranger who answers a message we sent
  const contactId = strOrNull(conv, "contactId");
  if (!contactId && input.direction === "in" && (unsure || priorOut) && num(conv, "needsMatch") !== 1) {
    ctx.db.run(`UPDATE inbox_conversation SET "needsMatch" = ?, version = ?, updated_at = ? WHERE id = ?`, 1, nextVersion(conv), ctx.now(), id);
  }
  const taskId = await ensureTask(ctx, id);

  // replies reach the people who follow, and the campaign owner
  conv = getConversation(ctx, id) as Row;
  const cid = strOrNull(conv, "contactId");
  if (cid && input.direction === "in") {
    if (first(ctx.db.all(`SELECT id FROM inbox_follow WHERE "contactId" = ? AND deleted_at IS NULL`, cid))) {
      ctx.emit("conversation.reply_received", `record/${cid}`, { conversationId: id, contactId: cid, channel: input.channel }, { vis: "participants" });
    }
    const campaign = input.campaignId ?? strOrNull(conv, "campaignId");
    if (campaign) ctx.emit("conversation.campaign_reply", `record/${cid}`, { conversationId: id, contactId: cid, campaignId: campaign, channel: input.channel }, { vis: "participants" });
  }
  return answer(ctx, conv, taskId);
}

/** The Needs you task of a conversation that needs a match: the one already raised, else a new one (and the event, once). A task module that is down never fails the linking. */
async function ensureTask(ctx: InboxCtx, id: string): Promise<string | undefined> {
  const conv = getConversation(ctx, id);
  if (!conv || strOrNull(conv, "contactId") || num(conv, "needsMatch") !== 1) return undefined;
  const have = first(ctx.db.all(`SELECT "taskId" FROM inbox_match_task WHERE "conversationId" = ?`, id));
  if (have) return str(have, "taskId");
  try {
    const taskId = await raiseTask(ctx, conv);
    ctx.db.run(`INSERT OR IGNORE INTO inbox_match_task ("conversationId", "taskId") VALUES (?, ?)`, id, taskId);
    ctx.emit("conversation.needs_match", `entity/${id}`, { conversationId: id, taskId });
    return taskId;
  } catch (e) {
    ctx.log.warn("inbox: could not raise Needs a match", { code: codeOf(e) });
    return undefined;
  }
}

function answer(ctx: InboxCtx, conv: Row, taskId?: string): { conversationId: string; contactId?: string; linked: "sure" | "unsure" | "none"; taskId?: string } {
  const id = str(conv, "id");
  const contactId = strOrNull(conv, "contactId");
  const task = taskId ?? (num(conv, "needsMatch") === 1 ? strOrNull(first(ctx.db.all(`SELECT "taskId" FROM inbox_match_task WHERE "conversationId" = ?`, id)), "taskId") ?? undefined : undefined);
  const out: { conversationId: string; contactId?: string; linked: "sure" | "unsure" | "none"; taskId?: string } = {
    conversationId: id, linked: contactId ? "sure" : num(conv, "needsMatch") === 1 ? "unsure" : "none",
  };
  if (contactId) out.contactId = contactId;
  if (task) out.taskId = task;
  return out;
}

async function raiseTask(ctx: InboxCtx, conv: Row): Promise<string> {
  const owner = strOrNull(conv, "ownerId");
  const who = str(conv, "displayName") || str(conv, "address");
  const res = obj(await ctx.call("tasks.create", {
    title: `Match ${who} to a record`, kind: "work", assigned: owner ? { kind: "person", id: owner } : { kind: "role", id: "admin" },
    why: "A sender wrote to you and could not be matched to a contact or company with certainty.", summary: str(conv, "lastPreview") || who,
    idempotencyKey: `inbox-match-${str(conv, "id")}`, source: { kind: "manual", id: str(conv, "id") },
  }));
  const id = text(obj(res.task).id);
  if (!id) throw new Error("tasks.create answered without a task");
  return id;
}

// ---- inbox.match / unmatch / match_new

export async function match(
  ctx: InboxCtx, input: { conversationId: string; recordId: string; rememberAddress?: boolean },
): Promise<{ conversation: ConversationRow; undoToken: string }> {
  ensure(ctx);
  if (!isId("cnv", input.conversationId)) bad(ctx, "That is not a conversation id.");
  if (!isId("rec", input.recordId)) bad(ctx, "That is not a record id.");
  const conv = getConversation(ctx, input.conversationId) ?? missing(ctx, "There is no such conversation.");
  if (strOrNull(conv, "contactId")) refuse(ctx, "This conversation is already matched to a record. Undo that match first.");
  const rec = (await findRecord(ctx, input.recordId)) ?? missing(ctx, "There is no such contact or company.");
  const added = input.rememberAddress === false ? undefined : await remember(ctx, rec.id, str(conv, "address"), input.conversationId);
  const out = await attach(ctx, conv, rec, byOf(ctx), added);
  return { conversation: toConversation(ctx, out.conversation), undoToken: out.token };
}

/** Teach the record the sender's address, so the next message matches by itself. A record that already has it is fine. Returns the address row to take back on Undo. */
async function remember(ctx: InboxCtx, contactId: string, address: string, conversationId: string): Promise<string | undefined> {
  if (!address) return undefined;
  try {
    const res = obj(await ctx.call("contacts.address.add", { contactId, kind: kindOfAddress(address), value: address, idempotencyKey: `inbox-remember-${conversationId}-${contactId}` }));
    return text(obj(res.address).id) || undefined;
  } catch (e) {
    if (codeOf(e) === "validation.duplicate") return undefined;   // the record already had it: nothing to take back later
    ctx.log.warn("inbox: could not remember the address on the record", { code: codeOf(e) });
    return undefined;
  }
}

export async function unmatch(ctx: InboxCtx, input: { conversationId: string; undoToken?: string }): Promise<{ conversation: ConversationRow }> {
  ensure(ctx);
  if (!isId("cnv", input.conversationId)) bad(ctx, "That is not a conversation id.");
  const row = input.undoToken !== undefined
    ? first(ctx.db.all(`SELECT * FROM inbox_undo WHERE token = ? AND undone = ?`, input.undoToken, 0))
    : first(ctx.db.all(`SELECT * FROM inbox_undo WHERE "targetId" = ? AND undone = ? ORDER BY at DESC, token ASC`, input.conversationId, 0));
  if (!row || (str(row, "targetId") !== input.conversationId && str(row, "sourceId") !== input.conversationId)) {
    refuse(ctx, "There is no match to undo for this conversation.");
  }
  const sourceId = str(row, "sourceId");
  const targetId = str(row, "targetId");
  const before = obj(JSON.parse(str(row, "snapshot") || "{}"));
  const itemIds = list(JSON.parse(str(row, "itemIds") || "[]")).filter((x): x is string => typeof x === "string");
  const now = ctx.now();
  if (str(row, "mode") === "merge") {
    const src = first(ctx.db.all(`SELECT * FROM inbox_conversation WHERE id = ?`, sourceId)) ?? missing(ctx, "The sender's conversation is gone.");
    ctx.db.run(`UPDATE inbox_conversation SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, null, nextVersion(src), now, sourceId);
    moveItems(ctx, itemIds, sourceId);
    refresh(ctx, sourceId);
    refresh(ctx, targetId);
  } else {
    const cur = getConversation(ctx, sourceId) ?? missing(ctx, "The sender's conversation is gone.");
    ctx.db.run(
      `UPDATE inbox_conversation SET "contactId" = ?, "displayName" = ?, "needsMatch" = ?, "ownerId" = ?, version = ?, updated_at = ? WHERE id = ?`,
      null, text(before.displayName) || str(cur, "address"), typeof before.needsMatch === "number" ? before.needsMatch : 0, typeof before.ownerId === "string" ? before.ownerId : null, nextVersion(cur), now, sourceId,
    );
  }
  ctx.db.run(`UPDATE inbox_undo SET undone = ? WHERE token = ?`, 1, str(row, "token"));
  const added = typeof before.addedAddressId === "string" ? before.addedAddressId : "";
  if (added) {
    try {
      await ctx.call("contacts.address.remove", { contactId: str(row, "recordId"), addressId: added });
    } catch (e) {
      ctx.log.warn("inbox: could not take the remembered address back", { code: codeOf(e) });
    }
  }
  ctx.emit("conversation.unmatched", `record/${str(row, "recordId")}`, { conversationId: sourceId, recordId: str(row, "recordId") });
  return { conversation: toConversation(ctx, getConversation(ctx, sourceId) as Row) };
}

export async function matchNew(
  ctx: InboxCtx, input: { conversationId: string; type: "contact" | "company"; name?: string },
): Promise<{ recordId: string; conversation: ConversationRow }> {
  ensure(ctx);
  if (!isId("cnv", input.conversationId)) bad(ctx, "That is not a conversation id.");
  if (input.type !== "contact" && input.type !== "company") bad(ctx, "Create a contact or a company.");
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 200)) bad(ctx, "The name must be 1 to 200 characters.");
  const conv = getConversation(ctx, input.conversationId) ?? missing(ctx, "There is no such conversation.");
  if (strOrNull(conv, "contactId")) refuse(ctx, "This conversation is already matched to a record.");
  const address = str(conv, "address");
  const display = str(conv, "displayName");
  const name = input.name?.trim() || (display && display !== address ? display : address.includes("@") ? address.split("@")[0] ?? address : address);
  const fields: Json = { name };
  const kind = kindOfAddress(address);
  if (input.type === "contact" && kind === "email") fields.email = address;
  if (input.type === "contact" && kind === "phone") fields.phone = address;
  const made = obj(obj(await ctx.call("records.create", { type: input.type, fields, idempotencyKey: `inbox-new-${input.conversationId}` })).record);
  const recordId = text(made.id);
  if (!recordId) throw new Error("records.create answered without a record");
  const rec: RecordLite = { id: recordId, type: input.type, fields: obj(made.fields).name ? obj(made.fields) : fields };
  const added = input.type === "company" || kind === "handle" ? await remember(ctx, recordId, address, input.conversationId) : undefined;
  const out = await attach(ctx, conv, rec, byOf(ctx), added);
  return { recordId, conversation: toConversation(ctx, out.conversation) };
}

export async function matchSuggestions(ctx: InboxCtx, input: { conversationId: string }): Promise<{ suggestions: Suggestion[] }> {
  ensure(ctx);
  if (!isId("cnv", input.conversationId)) bad(ctx, "That is not a conversation id.");
  const conv = getConversation(ctx, input.conversationId) ?? missing(ctx, "There is no such conversation.");
  if (strOrNull(conv, "contactId")) return { suggestions: [] };
  const found = await candidatesFor(ctx, str(conv, "address"), str(conv, "displayName"));
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  for (const c of [...found.sure, ...found.unsure]) {
    if (seen.has(c.recordId)) continue;
    seen.add(c.recordId);
    suggestions.push({ recordId: c.recordId, type: c.type, name: c.name, score: c.score, why: WHY[c.via] });
  }
  return { suggestions: suggestions.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)) };
}

// ---- inbox.mark_read, inbox.follow_set

export function markRead(ctx: InboxCtx, input: { conversationId: string; read?: boolean }): { conversation: ConversationRow } {
  ensure(ctx);
  if (!isId("cnv", input.conversationId)) bad(ctx, "That is not a conversation id.");
  const conv = getConversation(ctx, input.conversationId) ?? missing(ctx, "There is no such conversation.");
  const read = input.read !== false;
  if (read) ctx.db.run(`UPDATE inbox_item SET unread = ? WHERE "conversationId" = ?`, 0, input.conversationId);
  else {
    const latest = first(ctx.db.all(`SELECT id FROM inbox_item WHERE "conversationId" = ? AND direction = ? ORDER BY at DESC, id ASC LIMIT ?`, input.conversationId, "in", 1));
    if (latest) ctx.db.run(`UPDATE inbox_item SET unread = ? WHERE id = ?`, 1, str(latest, "id"));
  }
  const items = rowsOf(ctx.db.all(`SELECT unread FROM inbox_item WHERE "conversationId" = ?`, input.conversationId));
  const unread = items.filter((i) => num(i, "unread") === 1).length;
  if (unread !== num(conv, "unreadCount")) {
    ctx.db.run(`UPDATE inbox_conversation SET "unreadCount" = ?, version = ?, updated_at = ? WHERE id = ?`, unread, nextVersion(conv), ctx.now(), input.conversationId);
  }
  return { conversation: toConversation(ctx, getConversation(ctx, input.conversationId) as Row) };
}

export async function followSet(
  ctx: InboxCtx, input: { contactId: string; follow: boolean; alertOnReplies?: boolean },
): Promise<{ following: boolean; alertOnReplies: boolean }> {
  ensure(ctx);
  if (!isId("rec", input.contactId)) bad(ctx, "That is not a record id.");
  if (typeof input.follow !== "boolean") bad(ctx, "Say whether to follow.");
  await ctx.call("follows.toggle", { resource: { type: "record", id: input.contactId }, on: input.follow });
  const now = ctx.now();
  const existing = first(ctx.db.all(`SELECT * FROM inbox_follow WHERE "contactId" = ? AND "principalId" = ? AND deleted_at IS NULL`, input.contactId, ctx.principal.id));
  const had = followOf(ctx, input.contactId);
  const alert = input.follow ? (input.alertOnReplies ?? had.alertOnReplies) : false;
  if (input.follow) {
    if (existing) ctx.db.run(`UPDATE inbox_follow SET "alertOnReplies" = ?, version = ?, updated_at = ? WHERE id = ?`, alert ? 1 : 0, nextVersion(existing), now, str(existing, "id"));
    else {
      ctx.db.run(
        `INSERT INTO inbox_follow (id, "contactId", "principalId", "alertOnReplies", version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId("fol", now), input.contactId, ctx.principal.id, alert ? 1 : 0, 1, now, null,
      );
    }
  } else if (existing) {
    ctx.db.run(`UPDATE inbox_follow SET deleted_at = ?, "alertOnReplies" = ?, version = ?, updated_at = ? WHERE id = ?`, now, 0, nextVersion(existing), now, str(existing, "id"));
  }
  if (input.follow !== had.followed || alert !== had.alertOnReplies) {
    ctx.emit("conversation.follow_changed", `record/${input.contactId}`, { contactId: input.contactId, principalId: ctx.principal.id, following: input.follow, alertOnReplies: alert }, { vis: "participants" });
  }
  return { following: input.follow, alertOnReplies: alert };
}
