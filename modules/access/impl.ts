// Access module (lane L7a). Host keeps this stub until a later packet flips status to live.
import { handlers } from "./handlers/index.ts";
import { inline } from "./projections.ts";
import { consumers, hostCalls } from "./consumers.ts";
import { lapseDue } from "./handlers/exceptions.ts";
import { warmRows } from "./handlers/share.ts";
import { readOnly } from "./projections.ts";
import type { AccessCtx } from "./projections.ts";

export { handlers };
export const projections = { inline, consumers };
export const codecs = {};
export { inline, consumers, hostCalls };

/** Every 30 seconds: a permission exception whose end has come lapses, one audited access.exceptions.lapse each (the kernel already stops honouring it at its end). */
export const periodic = {
  "access.exceptions_lapse": {
    everyMs: 30_000,
    immediate: true,
    run: (ctx: Parameters<typeof lapseDue>[0]): Promise<string[]> => lapseDue(ctx),
  },
  /** Ten seconds after a start (once per database): the rows people are served are built, so the first list of Files does not wait for the first build. */
  "access.warm_rows": {
    everyMs: 10_000,
    run: (ctx: AccessCtx): Promise<{ warmed: boolean }> =>
      readOnly(warmRows as unknown as (c: AccessCtx, input: Record<string, never>) => Promise<{ warmed: boolean }>)(
        ctx,
        {},
      ),
  },
};
