// Idempotent effects (0.6 kernel/core/idem.js, now durable). The key is scoped to the principal and the capability; a repeated key returns the first result and runs nothing; the
// same key with different input is a conflict, never a quiet second write; a failure frees the key. Two callers racing on one key share one run.
import { canonical } from "../../../lib/canonical.ts";
import { LogError } from "../log/errors.ts";
import { sha256Hex } from "../log/hash.ts";
import type { IdemRecord } from "./table.ts";

export { IdempotencyTable, IDEM_TTL_MS } from "./table.ts";
export type { IdemRecord } from "./table.ts";

/** Where records live: the db worker in production (LogClient.idemBackend), a table directly in tests. */
export interface IdemBackend {
  get(key: string): Promise<IdemRecord | null> | IdemRecord | null;
  put(key: string, principal: string, cap: string, rec: IdemRecord): Promise<unknown> | unknown;
}

export function createIdempotency(backend: IdemBackend) {
  const inflight = new Map<string, { hash: string; p: Promise<unknown> }>();
  return Object.freeze({
    async once<T>(principal: string, cap: string, key: string | undefined | null, input: unknown, run: () => Promise<T>): Promise<T> {
      if (key === undefined || key === null) return run();
      if (typeof key !== "string" || !key || key.length > 200) throw new LogError("bad_key", "an idempotency key is a short text");
      const k = `${principal}|${cap}|${key}`;
      const hash = sha256Hex(canonical(input ?? null));
      const running = inflight.get(k);
      if (running) {
        if (running.hash !== hash) throw new LogError("idem_conflict", "that key was used for different input");
        return running.p as Promise<T>;
      }
      const p = (async () => {
        const had = await backend.get(k);
        if (had) {
          if (had.hash !== hash) throw new LogError("idem_conflict", "that key was used for different input");
          return had.result as T;
        }
        const result = await run();
        await backend.put(k, principal, cap, { hash, result: result === undefined ? null : result });
        return result;
      })();
      inflight.set(k, { hash, p });
      try { return await p; } finally { inflight.delete(k); }
    },
  });
}
