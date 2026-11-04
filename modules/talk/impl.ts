// talk module entry (Talk). The host registers its half once at boot with setTalkHost (the provider's grant, with the key read from the Vault there): see projections.ts.
import type { Handler } from "../../host/src/invoke.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import * as h from "./handlers/index.ts";
import { setTalkHost } from "./projections.ts";

export { setTalkHost };
export type { TalkHost } from "./projections.ts";

export const handlers: Record<string, Handler> = {
  "talk.status": (ctx, i) => h.status(ctx as never, i as never),
  "talk.configure": (ctx, i) => h.configure(ctx as never, i as never),
  "talk.connect": (ctx, i) => h.connect(ctx as never, i as never),
  "talk.disconnect": (ctx, i) => h.disconnect(ctx as never, i as never),
  "talk.session": (ctx, i) => h.session(ctx as never, i as never),
  "talk.ask_key": (ctx, i) => h.askKey(ctx as never, i as never),
  "talk.space.status": (ctx, i) => h.spaceStatus(ctx as never, i as never),
  "talk.space.connect": (ctx, i) => h.spaceConnect(ctx as never, i as never),
  "talk.space.configure": (ctx, i) => h.spaceConfigure(ctx as never, i as never),
  "talk.space.check": (ctx, i) => h.spaceCheck(ctx as never, i as never),
  "talk.space.disconnect": (ctx, i) => h.spaceDisconnect(ctx as never, i as never),
};

export const projections = { inline: {}, consumers: {} };

/** Where the host registers its half at boot (ruling 31): the loader reads this export. */
export const hostSeams: SeamSetters = { setTalkHost };
