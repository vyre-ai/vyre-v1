// After the local wipe (ARCH 5.7, golden flow 9): the device tells the server it has purged, with devices.purge_ack, so the server can record device.purged. The ack is sent only after the wipe
// finished without errors (a failed wipe throws and nothing is acknowledged: data left behind is not a purge), once per device and epoch, and retried with a growing delay when the server cannot
// be reached; the wipe itself never waits on it. The client never imports sync: the wipe is passed in as a function.

export const PURGE_ACK_CAPABILITY = "devices.purge_ack" as const;

export interface PurgeAckOpts {
  /** Delay before the n-th retry, ms. Default 500 doubling to 30 s. */
  backoffMs?: (tries: number) => number;
  /** Give up after this many tries (the server then learns on the next contact). Default 8. */
  maxTries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PurgeAcker {
  /** Run the wipe; when it completes, acknowledge once. Returns what the wipe returned. A wipe that throws acknowledges nothing and rethrows. */
  afterWipe<R>(deviceId: string, epoch: number, wipe: () => Promise<R>): Promise<R>;
  /** Tries made for a device and epoch, and whether the server took it. */
  status(deviceId: string, epoch: number): { tries: number; acked: boolean };
}

const defaultBackoff = (tries: number): number => Math.min(30_000, 500 * 2 ** Math.max(0, tries - 1));

export function createPurgeAcker(call: (cap: string, input: unknown) => Promise<unknown>, o: PurgeAckOpts = {}): PurgeAcker {
  const backoff = o.backoffMs ?? defaultBackoff;
  const max = o.maxTries ?? 8;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const seen = new Map<string, { tries: number; acked: boolean; running: Promise<void> | null }>();
  const keyOf = (d: string, e: number): string => `${d}\u0000${e}`;

  async function ack(deviceId: string, st: { tries: number; acked: boolean }): Promise<void> {
    while (!st.acked && st.tries < max) {
      st.tries++;
      try {
        await call(PURGE_ACK_CAPABILITY, { deviceId });
        st.acked = true;
      } catch {
        if (st.tries < max) await sleep(backoff(st.tries));
      }
    }
  }

  return {
    async afterWipe(deviceId, epoch, wipe) {
      const result = await wipe();
      const k = keyOf(deviceId, epoch);
      let st = seen.get(k);
      if (!st) { st = { tries: 0, acked: false, running: null }; seen.set(k, st); }
      if (!st.running && !st.acked) { const s = st; s.running = ack(deviceId, s).finally(() => { s.running = null; }); }
      // the wipe's caller does not wait for the server: the ack carries on in the background
      return result;
    },
    status(deviceId, epoch) {
      const st = seen.get(keyOf(deviceId, epoch));
      return st ? { tries: st.tries, acked: st.acked } : { tries: 0, acked: false };
    },
  };
}
