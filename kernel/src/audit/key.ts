// The Space's checkpoint signing key and how the owners' devices come to trust it (DESIGN-wink 2; K5). A Space is an identity whose list holds its owners (identity/chain.ts). The checkpoint key
// is a Space key, held outside the database, and ENDORSED by an owner: an owner's device signs `{ space, key_id, pub }`, the endorsement is kept in the log, and a device accepts the key only
// after checking that signature against the Space's own identity chain (the owner is on the list, the device is on the owner's own list as it stood then). So the home cannot swap the key
// under the devices, and the owners' devices hold the checkpoints it signs (`createDeviceCheckpoints`).
import * as chain from "../identity/chain.ts";
import type { Ctx, Op, SignFn } from "../identity/chain.ts";
import { KernelError } from "../identity/errors.ts";

const TAG = "vyre-space-key-v1\n";
const REVOKE_TAG = "vyre-space-key-revoked-v1\n";
const enc = new TextEncoder();

export interface SpaceKey { space: string; key_id: string; pub: string }
interface Position { ts: number; via_seq: number; via_head: string }
/** An owner's endorsement of a Space key, signed by one of the owner's devices (`via`) at a position of the owner's own list. */
export interface Endorsement extends SpaceKey, Position { by: string; via: string; sig: string }
export interface Revocation extends Omit<SpaceKey, "pub">, Position { by: string; via: string; sig: string }
export interface OwnerSigner { by: string; via: string; viaPos: { via_seq: number; via_head: string }; ts: number; sign: SignFn }

/** The bytes an owner's device signs to endorse the Space's checkpoint key: the key, and the position of the owner's own list the device relied on, so a removed device's signature cannot be backdated into validity. */
export const endorsementBytes = (e: SpaceKey & Position): Uint8Array => enc.encode(TAG + chain.canonical({ space: e.space, key_id: e.key_id, pub: e.pub, ts: e.ts, via_seq: e.via_seq, via_head: e.via_head }));
/** The bytes an owner's device signs to revoke the Space's checkpoint key. Any owner may. */
export const revocationBytes = (r: Omit<SpaceKey, "pub"> & Position): Uint8Array => enc.encode(REVOKE_TAG + chain.canonical({ space: r.space, key_id: r.key_id, ts: r.ts, via_seq: r.via_seq, via_head: r.via_head }));

/** Check a revocation against the Space's identity chain, the same way an endorsement is checked. */
export async function verifyRevocation(spaceOps: Op[], r: Revocation, ctx: Ctx): Promise<Omit<SpaceKey, "pub">> {
  try {
    const now = ctx.now ?? Date.now();
    const state = await chain.stateAt(spaceOps, r.ts, { now, ...(ctx.ownerOps ? { ownerOps: ctx.ownerOps } : {}) });
    if (!state || state.kind !== "space" || state.id !== r.space) throw new Error("not this Space");
    const { pub, signing } = await chain.signerKey(state, r.by, r.via, r.ts, { ...ctx, live: true, now }, { seq: r.via_seq, head: r.via_head });
    if (!(await chain.verifyWith(pub, revocationBytes(r), r.sig, signing))) throw new Error("bad signature");
  } catch (err) { throw new KernelError("bad_revocation", "that is not an owner's revocation of the Space key", String(err instanceof Error ? err.message : err)); }
  return { space: r.space, key_id: r.key_id };
}

/** Build the endorsement an owner's device signs. `sign(bytes)` is that device's key. */
export async function endorse(key: SpaceKey, owner: OwnerSigner): Promise<Endorsement> {
  const body = { space: key.space, key_id: key.key_id, pub: key.pub, ts: owner.ts, via_seq: owner.viaPos.via_seq, via_head: owner.viaPos.via_head };
  return { ...body, by: owner.by, via: owner.via, sig: chain.b64u(await owner.sign(endorsementBytes(body))) };
}
