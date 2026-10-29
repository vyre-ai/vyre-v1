// The phone of the open Space (spec 3.3): a Twilio Voice device the softphone dock rings and dials through. The device is made only when the Space can mint a Voice token (a number is claimed and the
// server holds the telephony key); otherwise `openPhone` answers undefined and the shell draws no dock. The SDK is loaded by the caller (`loadDevice`): this file never imports it, so a build without
// the package still exports.
import type { PhoneCallLike, PhoneDeviceLike } from "../../../../../ui/src/Softphone/index.tsx";
import { inboxData } from "../providers/inbox-data.ts";
import type { InboxData } from "../../places/inbox/sidebar/data.tsx";
import type { RealSession } from "./session.ts";

/** What the Voice SDK's Device offers, as far as the softphone uses it. */
export interface VoiceDeviceLike {
  register(): Promise<void>;
  connect(options: { params: Record<string, string> }): Promise<PhoneCallLike>;
  on(event: "incoming", handler: (call: PhoneCallLike) => void): void;
  destroy(): void;
}
export type LoadVoiceDevice = (token: string) => Promise<VoiceDeviceLike>;

export interface Phone { device: PhoneDeviceLike; data: InboxData; close(): void }

/** The phone for a session, or undefined when this Space has no telephony set up. `openConversation` opens a caller's conversation in the Inbox. */
export async function openPhone(session: Pick<RealSession, "call" | "runtime">, o: { loadDevice?: LoadVoiceDevice | undefined; openConversation(id: string): void }): Promise<Phone | undefined> {
  if (o.loadDevice === undefined) return undefined;
  if (session.runtime.isDeferred("telephony.voice_token")) return undefined;
  let token: string;
  try {
    const out = (await session.call("telephony.voice_token", {})) as { token?: unknown };
    if (typeof out.token !== "string" || out.token === "") return undefined;
    token = out.token;
  } catch {
    return undefined; // no number or no telephony key: the dock simply does not show
  }
  const dev = await o.loadDevice(token);
  await dev.register();
  return {
    device: { connect: (opts) => dev.connect(opts), on: (event, handler) => dev.on(event, handler), destroy: () => dev.destroy() },
    data: inboxData(session.runtime, o.openConversation),
    close: () => dev.destroy(),
  };
}
