// Access module (lane L7a). Host keeps this stub until a later packet flips status to live.
import { handlers } from "./handlers/index.ts";
import { inline, readOnly } from "./projections.ts";
import { consumers, hostCalls } from "./consumers.ts";
import { lapseDue } from "./handlers/exceptions.ts";
import { warmLists } from "./handlers/share.ts";

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
  /** Once after a start (then every ten minutes, when it costs nothing): the share state and the per-person index are made in slices in the background, so the first Files list finds them ready. */
  "access.warm_lists": {
    everyMs: 600_000,
    immediate: true,
    run: (ctx: Parameters<typeof warmLists>[0]): Promise<string[]> =>
      readOnly((c: typeof ctx, _none: void) => warmLists(c))(ctx),
  },
};
