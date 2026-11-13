// "The owner asked": an agent acting for a person may use that person's own controls on a thing of theirs when the turn it is in was started by that person's own message.
// One helper for every module (modules do not import each other, so it lives here). The proof is the server's: engine.turn.asked_by reads the calling agent's running turn in the calling chat from the
// queue and the message mirror the turn engine wrote, so nothing the agent sends counts. A routine, a goal wake, a watcher, a hand-off, an agent's message and a Job line never count.
export interface AskedBy { person: string; messageIds: string[]; at: number }
interface AskCtx { principal: { kind: string; id: string }; actingFor?: string | undefined; call?: ((cap: string, input: unknown) => Promise<unknown>) | undefined }

/**
 * The person's asking message(s) when `ctx` is an agent acting for `ownerId` in a turn that `ownerId` started with their own message; otherwise undefined.
 * Never throws: a call that fails answers "nobody asked", so the caller refuses as it did before.
 */
export async function ownerAsked(ctx: AskCtx, ownerId: string): Promise<AskedBy | undefined> {
  if (ctx.principal.kind !== "agent" || ctx.actingFor === undefined || ctx.actingFor !== ownerId || !ctx.call) return undefined;
  try {
    const r = (await ctx.call("engine.turn.asked_by", {})) as { askedBy?: AskedBy } | null;
    return r?.askedBy?.person === ownerId && r.askedBy.messageIds.length > 0 ? r.askedBy : undefined;
  } catch { return undefined; }
}
