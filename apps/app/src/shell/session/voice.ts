// The Twilio Voice device (spec 3.3): the one place the app imports @twilio/voice-sdk (2.18.5, Apache-2.0). It is a dynamic import, so the SDK is its own chunk and only a Space with a number and the
// telephony key ever loads it (session/phone.ts decides that before calling this). `loadTwilioDevice` is the `voice` loader the root hands the session gate.
import type { LoadVoiceDevice, VoiceDeviceLike } from "./phone.ts";

export const loadTwilioDevice: LoadVoiceDevice = async (token) => {
  const { Device } = await import("@twilio/voice-sdk");
  // codecs and the log level are the SDK's defaults, bar a quiet console
  const device = new Device(token, { logLevel: 1 });
  return device as unknown as VoiceDeviceLike;
};
