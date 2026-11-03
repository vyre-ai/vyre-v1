// Access module (lane L7a). Host keeps this stub until a later packet flips status to live.
import { handlers } from "./handlers/index.ts";
import { inline } from "./projections.ts";
import { consumers, hostCalls } from "./consumers.ts";
import { lapseDue } from "./handlers/exceptions.ts";

export { handlers };
export const projections = { inline, consumers };
export const codecs = {};
export { inline, consumers, hostCalls };

/** Every 30 seconds: a permission exception whose end has come lapses, one audited access.exceptions.lapse each (the kernel already stops honouring it at its end). */
export const periodic = {
  "access.exceptions_lapse": { everyMs: 30_000, immediate: true, run: (ctx: Parameters<typeof lapseDue>[0]): Promise<string[]> => lapseDue(ctx) },
};
