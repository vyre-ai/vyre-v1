// The Vault filler for values that are held for one use and never stored (spec 2.20): a GitHub installation token is held behind a handle, and a module that asks for it to be
// "filled" into a sink (the git module's credential slot) gets it there once. The token never goes back to the module that asked for the handle.
export interface FillerPort {
  /** Hold a value until `expiresAt` (ms) and return the handle that names it. */
  hold(value: string, expiresAt: number): string;
  /** Deliver the value held under `handle` to the sink for `kind`. False when the handle is unknown, expired or no sink takes that kind; the value stays held for the next fill until it expires. */
  fill(handle: string, into: { kind: string; ref: string }, now: number): boolean;
}

export function createFiller(sinks: Record<string, (ref: string, value: string) => void>, now: () => number = Date.now): FillerPort {
  const held = new Map<string, { value: string; expiresAt: number }>();
  return {
    hold(value, expiresAt) {
      for (const [h, v] of held) if (v.expiresAt <= now()) held.delete(h);
      const handle = `#fill_${[...globalThis.crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      held.set(handle, { value, expiresAt });
      return handle;
    },
    fill(handle, into, at) {
      const item = held.get(handle);
      const sink = sinks[into.kind];
      if (!item || !sink) return false;
      if (item.expiresAt <= at) { held.delete(handle); return false; }
      sink(into.ref, item.value);
      return true;
    },
  };
}
