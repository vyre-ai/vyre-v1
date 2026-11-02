// voice module entry (Talk). The host registers its half once at boot with setVoiceHost (the provider's grant, with the key read from the Vault there): see projections.ts.
import type { Handler } from "../../host/src/invoke.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import * as h from "./handlers/index.ts";
import { setVoiceHost } from "./projections.ts";

export { setVoiceHost };
export type { VoiceHost } from "./projections.ts";

export const handlers: Record<string, Handler> = {
  "voice.status": (ctx, i) => h.status(ctx as never, i as never),
  "voice.configure": (ctx, i) => h.configure(ctx as never, i as never),
  "voice.connect": (ctx, i) => h.connect(ctx as never, i as never),
  "voice.disconnect": (ctx, i) => h.disconnect(ctx as never, i as never),
  "voice.session": (ctx, i) => h.session(ctx as never, i as never),
  "voice.ask_key": (ctx, i) => h.askKey(ctx as never, i as never),
  "voice.space.status": (ctx, i) => h.spaceStatus(ctx as never, i as never),
  "voice.space.connect": (ctx, i) => h.spaceConnect(ctx as never, i as never),
  "voice.space.configure": (ctx, i) => h.spaceConfigure(ctx as never, i as never),
  "voice.space.check": (ctx, i) => h.spaceCheck(ctx as never, i as never),
  "voice.space.disconnect": (ctx, i) => h.spaceDisconnect(ctx as never, i as never),
};

export const projections = { inline: {}, consumers: {} };

/** Where the host registers its half at boot (ruling 31): the loader reads this export. */
export const hostSeams: SeamSetters = { setVoiceHost };
