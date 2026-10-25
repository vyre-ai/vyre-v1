// mail.mailbox.*, mail.auto_connect_members (spec 2.18: many inboxes, each mailbox private, shared with the Space or shared with chosen people).
// A mailbox row is the inbox. Personal ones come from mail.connect (core packet); this file adds the shared, agent and service mailboxes,
// the owner's controls (rename, privacy, pause, resume, disconnect) and the Pending connections auto-connect creates for mapped members.
// Who may do what is the host's job (the capabilities bind to the mailbox resource and carry the level); the list filters by view access.
import {
  bad, can, EMAIL, first, isId, missing, newId, normalizeEmail, num, rowsOf, str, strOrNull,
} from "../../projections.ts";
import type { MailCtx, Row } from "../../projections.ts";
import {
  duplicate, ensureAll, idemRef, liveMailbox, mailboxRow, pageOf, parsePage, preconditionFailed, rememberIdem,
} from "./common.ts";
import type { MailboxRow, PageIn } from "./common.ts";

const PRIVACY = new Set(["private", "space", "people"]);
const KINDS = new Set(["personal", "shared", "agent", "service"]);
const CREATE_KINDS = new Set(["shared", "agent", "service"]);
const CREATE_PROVIDERS = new Set(["google", "microsoft", "inbound_only"]);

const mbxId = (ctx: MailCtx, value: unknown): string => {
  if (!isId("mbx", value)) bad(ctx, "Mailbox id is not valid.");
  return value as string;
};

function loadLive(ctx: MailCtx, id: string): Row {
  const row = liveMailbox(ctx, id);
  if (!row) missing(ctx, "Mailbox does not exist.");
  return row;
}

function bump(ctx: MailCtx, row: Row, set: Record<string, string | number | null>): void {
  const cols = Object.keys(set);
  const now = ctx.now();
  ctx.db.run(
    `UPDATE mail_mailbox SET ${cols.map((c) => `"${c}" = ?`).join(", ")}, version = ?, updated_at = ? WHERE id = ?`,
    ...cols.map((c) => set[c] ?? null), num(row, "version") + 1, now, str(row, "id"),
  );
}

const answer = (ctx: MailCtx, id: string): { mailbox: MailboxRow } => ({ mailbox: mailboxRow(loadLive(ctx, id)) });

// ---- mail.mailbox.list / get

export async function mailboxList(
  ctx: MailCtx,
  input: PageIn & { scope?: "mine" | "shared" | "all"; kind?: "personal" | "shared" | "agent" | "service" },
): Promise<{ mailboxes: MailboxRow[]; next?: string; total: number }> {
  ensureAll(ctx);
  const scope = input.scope ?? "all";
  if (scope !== "mine" && scope !== "shared" && scope !== "all") bad(ctx, "Scope is not valid.");
  if (input.kind !== undefined && !KINDS.has(input.kind)) bad(ctx, "Kind is not valid.");
  const { offset, limit } = parsePage(ctx, input);

  const rows = input.kind
    ? rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE kind = ? AND deleted_at IS NULL`, input.kind))
    : rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE deleted_at IS NULL`));
  const me = ctx.principal.id;
  const mine = (r: Row): boolean => strOrNull(r, "ownerId") === me || strOrNull(r, "agentId") === me;
  const wanted = rows.filter((r) => (scope === "mine" ? mine(r) : scope === "shared" ? !mine(r) && str(r, "privacy") !== "private" : true));
  const visible = wanted.filter((r) => mine(r) || can(ctx, "view", { type: "mailbox", id: str(r, "id") }));
  visible.sort((a, b) => (str(a, "address") < str(b, "address") ? -1 : str(a, "address") > str(b, "address") ? 1 : str(a, "id") < str(b, "id") ? -1 : 1));
  const page = pageOf(visible, offset, limit);
  const out: { mailboxes: MailboxRow[]; next?: string; total: number } = { mailboxes: page.items.map(mailboxRow), total: page.total };
  if (page.next) out.next = page.next;
  return out;
}

export async function mailboxGet(ctx: MailCtx, input: { mailboxId: string }): Promise<{ mailbox: MailboxRow }> {
  ensureAll(ctx);
  return answer(ctx, mbxId(ctx, input.mailboxId));
}

// ---- mail.mailbox.create

export interface MailboxCreateIn {
  kind: "shared" | "agent" | "service";
  address: string;
  title: string;
  agentId?: string;
  provider?: "google" | "microsoft" | "inbound_only";
  privacy?: "private" | "space" | "people";
  idempotencyKey: string;
}

export async function mailboxCreate(ctx: MailCtx, input: MailboxCreateIn): Promise<{ mailbox: MailboxRow }> {
  ensureAll(ctx);
  const prior = idemRef(ctx, input.idempotencyKey, "mbxcreate");
  if (prior) {
    const row = liveMailbox(ctx, prior);
    if (row) return { mailbox: mailboxRow(row) };
  }
  if (!CREATE_KINDS.has(input.kind)) bad(ctx, "Kind must be shared, agent or service.");
  const address = normalizeEmail(input.address ?? "");
  if (!EMAIL.test(address)) bad(ctx, "Address is not an email.");
  if (typeof input.title !== "string") bad(ctx, "Title is required.");
  const provider = input.provider ?? "inbound_only";
  if (!CREATE_PROVIDERS.has(provider)) bad(ctx, "An IMAP mailbox is connected with mail.connect. Choose inbound only, Google or Microsoft here.");
  const privacy = input.privacy ?? "space";
  if (!PRIVACY.has(privacy)) bad(ctx, "Privacy is not supported.");
  if (input.agentId !== undefined && !isId("agt", input.agentId)) bad(ctx, "Agent id is not valid.");
  if (input.kind === "agent" && input.agentId === undefined) bad(ctx, "An agent mailbox needs the agent it belongs to.");
  if (input.kind !== "agent" && input.agentId !== undefined) bad(ctx, "Only an agent mailbox takes an agent.");
  if (first(ctx.db.all(`SELECT id FROM mail_mailbox WHERE address = ? AND deleted_at IS NULL`, address))) {
    duplicate(ctx, "A mailbox with that address already exists.");
  }

  const id = newId("mbx", ctx.now());
  const now = ctx.now();
  const title = input.title.trim() || address.split("@")[0] || address;
  // The person who creates a shared inbox owns it; an agent that creates one leaves it to the Space.
  const ownerId = ctx.principal.kind === "person" ? ctx.principal.id : null;
  // An inbound-only mailbox has nothing to pull, so it is live from the start; Google and Microsoft ones wait for their first sync.
  const state = provider === "inbound_only" ? "syncing" : "pending";
  ctx.db.run(
    `INSERT INTO mail_mailbox (
      id, kind, address, title, "ownerId", "agentId", provider, privacy, state, "connectionId", "lastSyncAt", paused, version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.kind, address, title, ownerId, input.agentId ?? null, provider, privacy, state, null, null, 0, 1, now, null,
  );
  rememberIdem(ctx, input.idempotencyKey, "mbxcreate", id);
  ctx.emit("mailbox.created", `mailbox/${id}`, { mailboxId: id, kind: input.kind, address });
  return answer(ctx, id);
}

// ---- mail.mailbox.update

export async function mailboxUpdate(ctx: MailCtx, input: { mailboxId: string; title?: string; agentId?: string }): Promise<{ mailbox: MailboxRow }> {
  ensureAll(ctx);
  const id = mbxId(ctx, input.mailboxId);
  const row = loadLive(ctx, id);
  const set: Record<string, string | number | null> = {};
  if (input.title !== undefined) {
    if (typeof input.title !== "string" || input.title.trim().length === 0) bad(ctx, "Title cannot be empty.");
    if (input.title.trim() !== str(row, "title")) set.title = input.title.trim();
  }
  if (input.agentId !== undefined) {
    if (!isId("agt", input.agentId)) bad(ctx, "Agent id is not valid.");
    if (str(row, "kind") === "personal") preconditionFailed(ctx, "A personal mailbox belongs to its owner. Create an agent mailbox for an agent.");
    if (input.agentId !== strOrNull(row, "agentId")) set.agentId = input.agentId;
  }
  if (Object.keys(set).length > 0) bump(ctx, row, set);
  return answer(ctx, id);
}

// ---- mail.mailbox.set_privacy

export async function mailboxSetPrivacy(ctx: MailCtx, input: { mailboxId: string; privacy: "private" | "space" | "people" }): Promise<{ mailbox: MailboxRow }> {
  ensureAll(ctx);
  const id = mbxId(ctx, input.mailboxId);
  if (!PRIVACY.has(input.privacy)) bad(ctx, "Privacy is not supported.");
  const row = loadLive(ctx, id);
  if (str(row, "privacy") === input.privacy) return answer(ctx, id);   // nothing changed, nothing announced
  // Mail already stored keeps the mark it got when it arrived; the new setting governs what arrives next.
  bump(ctx, row, { privacy: input.privacy });
  ctx.emit("mailbox.privacy_changed", `mailbox/${id}`, { mailboxId: id, privacy: input.privacy }, { vis: "participants" });
  return answer(ctx, id);
}

// ---- mail.mailbox.pause / resume / disconnect

export async function mailboxPause(ctx: MailCtx, input: { mailboxId: string }): Promise<{ mailbox: MailboxRow }> {
  ensureAll(ctx);
  const id = mbxId(ctx, input.mailboxId);
  const row = loadLive(ctx, id);
  if (str(row, "state") === "disconnected") preconditionFailed(ctx, "This mailbox is disconnected.");
  if (num(row, "paused") === 1 && str(row, "state") === "paused") return answer(ctx, id);
  bump(ctx, row, { paused: 1, state: "paused" });
  ctx.emit("mailbox.paused", `mailbox/${id}`, { mailboxId: id }, { vis: "participants" });
  return answer(ctx, id);
}

export async function mailboxResume(ctx: MailCtx, input: { mailboxId: string }): Promise<{ mailbox: MailboxRow }> {
  ensureAll(ctx);
  const id = mbxId(ctx, input.mailboxId);
  const row = loadLive(ctx, id);
  if (str(row, "state") === "disconnected") preconditionFailed(ctx, "This mailbox is disconnected. Connect it again.");
  if (num(row, "paused") !== 1 && str(row, "state") !== "paused") return answer(ctx, id);
  // Back to where it was: syncing if it has synced before or has nothing to pull, else waiting for its first sync.
  const live = typeof row.lastSyncAt === "number" || str(row, "provider") === "inbound_only";
  bump(ctx, row, { paused: 0, state: live ? "syncing" : "pending" });
  ctx.emit("mailbox.resumed", `mailbox/${id}`, { mailboxId: id }, { vis: "participants" });
  return answer(ctx, id);
}

/**
 * Remove a connection. The mailbox row is soft-removed so the same address can be connected again, its IMAP settings are deleted so nothing
 * can sign in, and sync stops because the mailbox no longer resolves. Mail already filed to records keeps its links.
 */
export async function mailboxDisconnect(ctx: MailCtx, input: { mailboxId: string }): Promise<{ disconnected: boolean }> {
  ensureAll(ctx);
  const id = mbxId(ctx, input.mailboxId);
  const existing = first(ctx.db.all(`SELECT * FROM mail_mailbox WHERE id = ?`, id));
  if (!existing) missing(ctx, "Mailbox does not exist.");
  if (existing.deleted_at !== null && existing.deleted_at !== undefined) return { disconnected: true };   // already gone: a retry succeeds quietly
  const now = ctx.now();
  ctx.db.run(`DELETE FROM mail_imap WHERE "mailboxId" = ?`, id);
  ctx.db.run(
    `UPDATE mail_mailbox SET state = ?, paused = ?, deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`,
    "disconnected", 1, now, num(existing, "version") + 1, now, id,
  );
  ctx.emit("mailbox.disconnected", `mailbox/${id}`, { mailboxId: id }, { vis: "participants" });
  return { disconnected: true };
}

// ---- mail.auto_connect_members

export interface AutoConnectIn {
  provider: "google" | "microsoft";
  members: { userId: string; email: string }[];
  idempotencyKey: string;
}

interface AutoConnectOut { created: number; notified: number; skipped: number }

/**
 * Pending mail connections for mapped members (spec 2.18). The connector decides who is mapped and who is excluded and whether auto-connect is on;
 * this creates the mailbox for each member that has none yet and raises one notice (mailbox.connected, auto) per new connection.
 * The member can then pause it or mark it private. A repeat call with the same key answers the first call's counts and changes nothing.
 */
export async function autoConnectMembers(ctx: MailCtx, input: AutoConnectIn): Promise<AutoConnectOut> {
  ensureAll(ctx);
  const prior = idemRef(ctx, input.idempotencyKey, "autoconnect");
  if (prior) {
    try {
      const o = JSON.parse(prior) as Partial<AutoConnectOut>;
      if (typeof o.created === "number" && typeof o.notified === "number" && typeof o.skipped === "number") return { created: o.created, notified: o.notified, skipped: o.skipped };
    } catch { /* fall through and run it again */ }
  }
  if (input.provider !== "google" && input.provider !== "microsoft") bad(ctx, "Provider must be google or microsoft.");
  if (!Array.isArray(input.members)) bad(ctx, "Members must be a list.");
  const out: AutoConnectOut = { created: 0, notified: 0, skipped: 0 };
  const seen = new Set<string>();
  for (const m of input.members) {
    const address = normalizeEmail(m?.email ?? "");
    if (!EMAIL.test(address) || !isId("usr", m?.userId) || seen.has(address)) { out.skipped += 1; continue; }
    seen.add(address);
    const have = first(ctx.db.all(`SELECT id FROM mail_mailbox WHERE address = ? AND provider = ? AND deleted_at IS NULL`, address, input.provider));
    if (have) { out.skipped += 1; continue; }
    const id = newId("mbx", ctx.now());
    const now = ctx.now();
    ctx.db.run(
      `INSERT INTO mail_mailbox (
        id, kind, address, title, "ownerId", "agentId", provider, privacy, state, "connectionId", "lastSyncAt", paused, version, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, "personal", address, address.split("@")[0] || address, m.userId, null, input.provider, "space", "pending", null, null, 0, 1, now, null,
    );
    out.created += 1;
    ctx.emit("mailbox.connected", `mailbox/${id}`, { mailboxId: id, memberId: m.userId, provider: input.provider, auto: true }, { vis: "participants" });
    out.notified += 1;
  }
  rememberIdem(ctx, input.idempotencyKey, "autoconnect", JSON.stringify(out));
  return out;
}
