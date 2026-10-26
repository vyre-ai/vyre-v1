// @reads /modules/chat/migrations/0002_private.sql
// Private chats are end to end (spec 5 b7, ARCH 4.13, 5.10, 6.3): a private thread and an Ask pane are enc=2, sealed under a key only the owner's devices hold.
//
//   envelope     what a sealed body or block looks like at rest: `enc2.1.<keyId>.<iv>.<ciphertext>.<tag>` (AES-256-GCM, the thread and message in the authenticated data, so a ciphertext cannot be moved
//                to another message or thread). The thread key is HKDF of the owner's personKey; the key tag is a one-way tag of it.
//   sealed post  chat.post goes through `guardPrivate`: the first envelope from the owner seals the thread, and from then on only envelopes are stored in it. A plain body in a sealed thread is
//                refused, so no bug or old client can leave readable text next to the sealed text. The module never opens an envelope outside a turn.
//   the turn     the Space runtime opens a private thread only for a turn of its owner (`beginPrivateTurn`): the owner must have opted in ("Let the Space continue my chats when my computer
//                is off", engine.runtime.opt_in), which left a runtime key wrapped for the Space runtime. The runtime unwraps it with its own private key, derives the thread key, reads and
//                replies through the returned handle, and `end()` wipes every key. Each open is a row in chat_private_turn: ids, times and counts, never text.
// Crypto primitives come from kernel/seal (boundary B3). Plaintext exists only in the memory of the device, and in the memory of a turn that its owner allowed.
import { aesUnwrap, aesWrap, hkdf32, openSeal, sealTo } from "../../../kernel/src/seal/index.ts";
import type { Box } from "../../../kernel/src/seal/index.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { NextStep } from "../../../packages/contracts/src/types.ts";
import { readFileSync } from "node:fs";
import { askerOf, encOf, ensure, lastMessages, mintId, raise, threadBy } from "../projections.ts";
import type { ChatCtx, Db, MessageRec, ThreadRec } from "../projections.ts";
import { isDirect, post, rootOf } from "./post.ts";
import type { PostInput } from "./post.ts";

// ---- schema -----------------------------------------------------------------------------------------------------------------------------------------

const SCHEMA = readFileSync(new URL("../migrations/0002_private.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

/** The tables of this packet. One cheap probe per handle. */
export function ensurePrivate(db: Db): void {
  ensure(db);
  if (ready.has(db)) return;
  try { db.all("SELECT thread FROM chat_private WHERE thread = ?", "probe"); db.all("SELECT id FROM chat_private_turn WHERE id = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  ready.add(db);
}

// ---- the envelope -----------------------------------------------------------------------------------------------------------------------------------

export const ENVELOPE_VERSION = "enc2.1";
const B64 = "[A-Za-z0-9_-]";
const ENVELOPE = new RegExp(`^enc2\\.1\\.(${B64}{16})\\.(${B64}{16})\\.(${B64}+)\\.(${B64}{22})$`);

export interface Envelope { keyId: string; box: Box }

export function parseEnvelope(v: unknown): Envelope | null {
  if (typeof v !== "string") return null;
  const m = ENVELOPE.exec(v);
  return m ? { keyId: m[1]!, box: { iv: m[2]!, ct: m[3]!, tag: m[4]! } } : null;
}
export const isEnvelope = (v: unknown): v is string => parseEnvelope(v) !== null;

/** The key of one private thread: HKDF of the owner's personKey, bound to the thread. */
export function threadKeyOf(personKey: Uint8Array, threadId: string): Buffer {
  return hkdf32(personKey, "vyre:chat:v1", `thread:${threadId}`);
}
/** A one-way tag of a thread key, carried in every envelope. It says which key sealed a message and nothing about the key. */
export function keyIdOf(threadKey: Uint8Array, threadId: string): string {
  return hkdf32(threadKey, "vyre:chat:keyid", threadId).subarray(0, 12).toString("base64url");
}

export const bodyAad = (threadId: string, messageId: string): string => `chat|${threadId}|${messageId}|body`;
export const blockAad = (threadId: string, messageId: string, index: number): string => `chat|${threadId}|${messageId}|block|${index}`;

export function sealText(threadKey: Uint8Array, threadId: string, aad: string, plain: string): string {
  const b = aesWrap(threadKey, Buffer.from(plain, "utf8"), aad);
  return `${ENVELOPE_VERSION}.${keyIdOf(threadKey, threadId)}.${b.iv}.${b.ct}.${b.tag}`;
}
/** Throws when the key, the thread, the message or the bytes are not the ones it was sealed with. */
export function openText(threadKey: Uint8Array, aad: string, envelope: string): string {
  const e = parseEnvelope(envelope);
  if (!e) throw new Error("not a sealed value");
  return aesUnwrap(threadKey, e.box, aad).toString("utf8");
}

// ---- the runtime key --------------------------------------------------------------------------------------------------------------------------------

const RUNTIME_PREFIX = "rk1.";
const runtimeAad = (person: string): string => `vyre:runtime-key:${person}`;

/** The device's side of the opt-in: the person's key wrapped for the Space runtime's public key. This string is what engine.runtime.opt_in stores. */
export function wrapForRuntime(runtimePublicKey: string, personKey: Uint8Array, person: string): string {
  return RUNTIME_PREFIX + Buffer.from(JSON.stringify(sealTo(runtimePublicKey, personKey, runtimeAad(person)))).toString("base64url");
}

export interface RuntimeKeyring {
  /** The person's key, from what their device wrapped. Throws on anything that is not the Space runtime's own. The caller wipes the result. */
  unwrap(wrapped: string, person: string): Buffer;
}
/** The Space runtime's half: it holds the private key, the host hands it in. */
export function createRuntimeKeyring(runtimePrivateKey: string): RuntimeKeyring {
  return {
    unwrap(wrapped, person) {
      if (!wrapped.startsWith(RUNTIME_PREFIX)) throw new Error("not a wrapped runtime key");
      const box = JSON.parse(Buffer.from(wrapped.slice(RUNTIME_PREFIX.length), "base64url").toString("utf8")) as Box & { eph: string };
      return openSeal(runtimePrivateKey, box, runtimeAad(person));
    },
  };
}

// ---- sealed threads ---------------------------------------------------------------------------------------------------------------------------------

export interface SealedRow { thread: string; owner: string; keyId: string; sealedAt: number }
export function sealedBy(db: Db, thread: string): SealedRow | null {
  const r = (db.all("SELECT thread, owner, keyId, sealedAt FROM chat_private WHERE thread = ?", thread) as Array<Record<string, unknown>>)[0];
  return r ? { thread: String(r["thread"]), owner: String(r["owner"]), keyId: String(r["keyId"]), sealedAt: Number(r["sealedAt"]) } : null;
}

/** Everything a stored value of a sealed thread may be: an envelope of the thread's key, or nothing (a block-only message has an empty body). */
function sealedOk(v: unknown, keyId: string): boolean {
  if (v === "") return true;
  return parseEnvelope(v)?.keyId === keyId;
}

/**
 * chat.post for private threads. A thread that is not sealed yet takes plain text as it always did (clients that have not sealed anything); the first message that arrives as an envelope from
 * the owner seals it. A sealed thread takes envelopes of its own key only: in the body and in the data of every block.
 */
export function guardPrivate(inner: (ctx: ChatCtx, input: PostInput) => Promise<unknown>): (ctx: ChatCtx, input: PostInput) => Promise<unknown> {
  return async (ctx, input) => {
    ensurePrivate(ctx.db);
    const t = threadBy(ctx.db, input.threadId);
    // A direct message between two people is not a chat with an agent: it keeps the plain rules of chat.post.
    const root = t && encOf(ctx.db, t) === 2 ? rootOf(ctx, t) : null;
    let seal: { thread: string; owner: string; keyId: string } | null = null;
    if (root && !isDirect(ctx, root)) {
      const row = sealedBy(ctx.db, root.id);
      const blocks = input.blocks ?? [];
      const sealing = parseEnvelope(input.body) !== null || blocks.some((b) => isEnvelope(b.data));
      if (sealing && input.clientId === undefined) {
        raise(ctx, "validation.bad_input", "Send your own message id with a sealed message: the id is part of what the seal is bound to.", { reason: "client_id_needed" });
      }
      if (row) {
        if (!sealedOk(input.body, row.keyId) || !blocks.every((b) => parseEnvelope(b.data)?.keyId === row.keyId)) {
          raise(ctx, "validation.bad_input", "This chat is end-to-end encrypted. Messages in it are stored sealed under your key, and plain text is not accepted.", { reason: "sealed_thread" });
        }
      } else {
        const first = parseEnvelope(input.body);
        if (first) {
          if (!blocks.every((b) => parseEnvelope(b.data)?.keyId === first.keyId)) raise(ctx, "validation.bad_input", "Seal the blocks of this message under the same key as its text.", { reason: "mixed_seal" });
          if (root.starter !== askerOf(ctx)) raise(ctx, "permission.no_grant", "Only the owner of a private chat can seal it.");
          seal = { thread: root.id, owner: askerOf(ctx), keyId: first.keyId };
        }
      }
    }
    const out = await inner(ctx, input);
    // The thread is sealed by a message that was stored, not by one that was refused.
    if (seal) ctx.db.run("INSERT OR IGNORE INTO chat_private (thread, owner, keyId, sealedAt) VALUES (?, ?, ?, ?)", seal.thread, seal.owner, seal.keyId, ctx.now());
    return out;
  };
}

// ---- a turn of the owner ----------------------------------------------------------------------------------------------------------------------------

export interface PrivateTurnDeps {
  keyring: RuntimeKeyring;
  /** What engine.runtime.opt_in stored for this person, or null when they have not opted in or turned it off. Wired by the host from the engine module. */
  wrappedRuntimeKey(person: string): string | null | Promise<string | null>;
}

export interface OpenMessage { id: string; seq: number; author: string; kind: MessageRec["kind"]; body: string; blocks: Array<Record<string, unknown>> }

export interface PrivateTurn {
  readonly threadId: string;
  readonly turnId: string;
  readonly person: string;
  /** The last `limit` messages (default 50), oldest first, opened. A message that is plain (written before the chat was sealed) is returned as it is. */
  read(opts?: { limit?: number }): OpenMessage[];
  /** The agent's answer, sealed under the thread key and stored through chat.post like any other message. */
  reply(text: string, opts?: { blocks?: Array<{ type: string; v: number; data: unknown }>; replyTo?: string }): Promise<unknown>;
  /** Wipe every key. Nothing opens after this. */
  end(): void;
}

const refuseOptIn = (ctx: ChatCtx, person: string): never => {
  const next: NextStep[] = [{ kind: "open_settings", label: "Turn on: Let the Space continue my chats when my computer is off" }];
  throw fail("permission.no_grant", ctx.trace.traceId, {
    message: "This chat is private to you. Your computer is off, and you have not let the Space continue your chats.", details: { reason: "runtime_opt_in", person }, next,
  });
};

/**
 * Open a private thread for one turn of its owner. The call must be a turn running for the owner (an agent or service acting for them): another person, an admin, or a turn of someone
 * else's gets nothing. The owner's opt-in must be on. The returned handle holds the keys in memory until `end()`.
 */
export async function beginPrivateTurn(ctx: ChatCtx, deps: PrivateTurnDeps, input: { threadId: string; turnId: string }): Promise<PrivateTurn> {
  ensurePrivate(ctx.db);
  const t = threadBy(ctx.db, input.threadId);
  if (!t || encOf(ctx.db, t) !== 2) raise(ctx, "validation.not_found", "That is not a private chat.");
  const root: ThreadRec = rootOf(ctx, t);
  const owner = root.starter;
  if (owner === undefined || askerOf(ctx) !== owner || (ctx.principal.kind !== "agent" && ctx.principal.kind !== "service")) {
    raise(ctx, "permission.no_grant", "A private chat opens only for a turn that its owner started.", { reason: "not_the_owner_turn" });
  }
  const wrapped = await deps.wrappedRuntimeKey(owner);
  if (wrapped === null) refuseOptIn(ctx, owner);
  let personKey: Buffer;
  try { personKey = deps.keyring.unwrap(wrapped!, owner); } catch { throw fail("permission.no_grant", ctx.trace.traceId, { message: "The Space cannot open your key. Turn the setting off and on again from your computer.", details: { reason: "runtime_key_unreadable" } }); }
  const key = threadKeyOf(personKey, root.id);
  personKey.fill(0);
  const keyId = keyIdOf(key, root.id);
  const sealed = sealedBy(ctx.db, root.id);
  if (sealed && sealed.keyId !== keyId) {
    key.fill(0);
    raise(ctx, "permission.no_grant", "The key the Space holds for you is not the one this chat was sealed with.", { reason: "key_mismatch" });
  }

  const rowId = mintId("cpt", ctx.now());
  ctx.db.run("INSERT INTO chat_private_turn (id, thread, turn, person, openedAt, closedAt, reads, replies) VALUES (?, ?, ?, ?, ?, NULL, 0, 0)", rowId, root.id, input.turnId, owner, ctx.now());
  let open = true;
  let reads = 0;
  let replies = 0;
  const live = (): void => { if (!open) throw new Error("this turn has ended and its keys are gone"); };
  const flush = (): void => { ctx.db.run("UPDATE chat_private_turn SET reads = ?, replies = ? WHERE id = ?", reads, replies, rowId); };

  return {
    threadId: root.id, turnId: input.turnId, person: owner,
    read(opts = {}) {
      live();
      const out: OpenMessage[] = lastMessages(ctx.db, input.threadId, Math.max(1, Math.min(opts.limit ?? 50, 500))).map((m) => {
        const plainOr = (v: string, aad: string): string => (isEnvelope(v) ? openText(key, aad, v) : v);
        const blocks = m.blocks.map((b, i) => (isEnvelope(b["data"]) ? { ...b, data: JSON.parse(openText(key, blockAad(m.thread, m.id, i), b["data"] as string)) as unknown } : b));
        return { id: m.id, seq: m.seq, author: m.author, kind: m.kind, body: plainOr(m.body, bodyAad(m.thread, m.id)), blocks };
      });
      reads += out.length;
      flush();
      return out;
    },
    async reply(text, opts = {}) {
      live();
      const id = mintId("msg", ctx.now());
      const body = sealText(key, root.id, bodyAad(input.threadId, id), text);
      const blocks = (opts.blocks ?? []).map((b, i) => ({ type: b.type, v: b.v, data: sealText(key, root.id, blockAad(input.threadId, id, i), JSON.stringify(b.data)) }));
      const out = await guardPrivate(post)(ctx, {
        threadId: input.threadId, body, ...(blocks.length > 0 ? { blocks } : {}), clientId: id, idempotencyKey: `${input.turnId}:${id}`,
        ...(opts.replyTo !== undefined ? { replyTo: opts.replyTo } : {}),
      });
      replies += 1;
      flush();
      return out;
    },
    end() {
      if (!open) return;
      open = false;
      key.fill(0);
      ctx.db.run("UPDATE chat_private_turn SET closedAt = ?, reads = ?, replies = ? WHERE id = ?", ctx.now(), reads, replies, rowId);
    },
  };
}
