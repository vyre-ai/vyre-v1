// Checks over public data: a device verifying that an owner endorsed the Space key, an owner's revocation of it, and two devices comparing the checkpoints they hold. No grant is decided here
// and no secret is read.
import crypto from "node:crypto";
import * as chain from "../identity/chain.ts";
import type { Ctx, Op } from "../identity/chain.ts";
import { KernelError } from "../identity/errors.ts";
import { endorsementBytes, revocationBytes } from "./key.ts";
import type { Endorsement, OwnerSigner, Revocation, SpaceKey } from "./key.ts";
import { verifyCheckpoint, eventAt } from "./index.ts";
import type { PublicKey } from "./index.ts";
import type { AuditLog } from "./log.ts";

export async function revokeKey(key: Omit<SpaceKey, "pub">, owner: OwnerSigner): Promise<Revocation> {
  const body = { space: key.space, key_id: key.key_id, ts: owner.ts, via_seq: owner.viaPos.via_seq, via_head: owner.viaPos.via_head };
  return { ...body, by: owner.by, via: owner.via, sig: chain.b64u(await owner.sign(revocationBytes(body))) };
}

/** The public key object for a base64 SPKI. */
export const publicKeyOf = (pub: string): crypto.KeyObject => crypto.createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });

/**
 * Check an endorsement against the Space's identity chain: the Space's list had this owner at that time, the owner's own chain had that device on it, and the device's signature covers exactly
 * this key. Throws a KernelError when it does not hold; returns the key to trust.
 */
export async function verifyEndorsement(spaceOps: Op[], e: Endorsement, ctx: Ctx): Promise<SpaceKey> {
  try {
    const now = ctx.now ?? Date.now();
    const state = await chain.stateAt(spaceOps, e.ts, { now, ...(ctx.ownerOps ? { ownerOps: ctx.ownerOps } : {}) });
    if (!state || state.kind !== "space" || state.id !== e.space) throw new Error("not this Space");
    if (crypto.createHash("sha256").update(Buffer.from(e.pub, "base64")).digest("hex").slice(0, 16) !== e.key_id) throw new Error("key id does not match the key");
    // `live`: the device must still be on the owner's current list as well as at the position it named, so a removed device cannot endorse.
    const { pub, signing } = await chain.signerKey(state, e.by, e.via, e.ts, { ...ctx, live: true, now }, { seq: e.via_seq, head: e.via_head });
    if (!(await chain.verifyWith(pub, endorsementBytes(e), e.sig, signing))) throw new Error("bad signature");
  } catch (err) { throw new KernelError("bad_endorsement", "the Space key is not endorsed by an owner of the Space", String(err instanceof Error ? err.message : err)); }
  return { space: e.space, key_id: e.key_id, pub: e.pub };
}

/**
 * Two devices compare the checkpoints they hold. The same position with two hashes is a split (the home told them different histories); a checkpoint that is valid for neither is refused. Two
 * honest checkpoints at different positions cannot be told apart without a log, so with one they are checked for inclusion.
 */
export function compareCheckpoints(a: unknown, b: unknown, publicKey: PublicKey, log?: Pick<AuditLog, "get">): { ok: boolean; why?: string } {
  if (!verifyCheckpoint(a, publicKey) || !verifyCheckpoint(b, publicKey)) return { ok: false, why: "bad_signature" };
  const x = a as { seq: number; hash: string }, y = b as { seq: number; hash: string };
  if (x.seq === y.seq) return x.hash === y.hash ? { ok: true } : { ok: false, why: "split_history" };
  if (!log) return { ok: true };
  const [lo, hi] = x.seq < y.seq ? [x, y] : [y, x];
  const e = eventAt(log, lo.seq), h = eventAt(log, hi.seq);
  return e && e.hash === lo.hash && h && h.hash === hi.hash ? { ok: true } : { ok: false, why: "history_differs" };
}
