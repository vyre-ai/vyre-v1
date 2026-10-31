// Phone access on the host (DESIGN-computers, "Phone access through vyre.run"): the PhonePort the command queue calls. A claim brings the relay link up when it is not (the public relay, for a computer
// with no relay configured), asks the relay for <name>.vyre.run over the authenticated control link, and hands back the box's public key, which the phone's link carries and pins.
import type { PhonePort } from "./commands.ts";
import type { RelayBox } from "../seams/relay.ts";

export interface PhoneLink {
  /** the relay link now, if one is up */
  current(): RelayBox | null;
  /** bring one up (or return the one that is); null where this daemon has nowhere to dial */
  start(): RelayBox | null;
  /** the link was stopped because only the phone address needed it */
  dropped(): void;
  /** true when a relay is configured for other reasons (--relay): the link stays up after a release */
  configured: boolean;
}

export function createPhonePort(link: PhoneLink): PhonePort {
  return {
    async claim(name, nickname) {
      const box = link.start();
      if (!box) return { status: "unavailable" };
      const r = await box.host.claim(name, nickname);
      return r.status === "claimed" ? { status: "claimed", boxKey: (await box.ready).boxKey } : { status: r.status };
    },
    async release() {
      const box = link.current();
      if (!box) return { status: "none" };
      const r = await box.host.release();
      if ((r.status === "released" || r.status === "none") && !link.configured) { box.stop(); link.dropped(); }
      return { status: r.status };
    },
  };
}
