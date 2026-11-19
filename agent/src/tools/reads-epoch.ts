// When an earlier tool result may no longer be in a model's view, the turn's repeat-read memory must be forgotten (r42-runtime-tokens; r-review high on 288d5ab89). Three events do that: the API driver compacts the
// conversation inside the turn (agent/src/drivers/api/session.ts), the turn is resumed after a lost host and its calls are replayed (agent/src/turn-engine/engine.ts), and a CLI engine's own session compacts (no
// signal reaches us: the repeat line is never used on that path, see ToolCtx.repeatSafe). One counter per turn; a read remembered under an older count is not trusted.
const epochs = new Map<string, number>();
const MAX = 2_000;

/** What was read in this turn so far is no longer to be pointed at. */
export function invalidateReads(turnId: string | undefined): void {
  if (turnId === undefined) return;
  epochs.set(turnId, (epochs.get(turnId) ?? 0) + 1);
  if (epochs.size > MAX) epochs.delete(epochs.keys().next().value as string);
}

export const readsEpoch = (turnId: string): number => epochs.get(turnId) ?? 0;
