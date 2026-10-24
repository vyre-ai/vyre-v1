// Hybrid logical clock (ARCH 5.1). Text form "<ms-hex>-<counter-hex>-<device-id>"; order is (ms, counter, deviceId).
// ms is written as 12 hex digits and counter as 4, so plain string comparison of two hlcs with the same device id agrees with compare().
// Client clock is max(local wall, lastSeenServerHlc + 1). The server clamps any client hlc whose ms is greater than server now + 5 minutes to server now and records skew_ms.

export interface Hlc { ms: number; counter: number; deviceId: string }

/** Largest ms a client hlc may carry ahead of the server's wall clock before the server clamps it. */
export const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_COUNTER = 0xffff;

export function formatHlc(h: Hlc): string {
  return `${h.ms.toString(16).padStart(12, "0")}-${h.counter.toString(16).padStart(4, "0")}-${h.deviceId}`;
}

/** Parse the text form; null when it is not one. The device id may itself contain dashes. */
export function parseHlc(s: string): Hlc | null {
  const m = /^([0-9a-f]{1,12})-([0-9a-f]{1,4})-(.+)$/.exec(String(s));
  if (!m) return null;
  return { ms: parseInt(m[1]!, 16), counter: parseInt(m[2]!, 16), deviceId: m[3]! };
}

/** Total order: negative when a is before b. */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}

/**
 * The next hlc for a device: ms = max(wall, last.ms) and the counter breaks ties, so two ticks in one millisecond differ
 * and a clock that runs backwards never produces a smaller value than `last`. `lastSeen` is the highest hlc this device has issued or received from the server;
 * the result is always strictly after it.
 */
export function tickHlc(deviceId: string, wallMs: number, lastSeen?: Hlc | null): Hlc {
  const last = lastSeen ?? null;
  if (!last || wallMs > last.ms) return { ms: wallMs, counter: 0, deviceId };
  if (last.counter < MAX_COUNTER) return { ms: last.ms, counter: last.counter + 1, deviceId };
  return { ms: last.ms + 1, counter: 0, deviceId };   // counter exhausted: move to the next millisecond
}

/** Merge a received hlc into local state (the receive rule): the result is after both `local` and `remote`. */
export function receiveHlc(deviceId: string, wallMs: number, local: Hlc | null, remote: Hlc): Hlc {
  const top = local && compareHlc(local, remote) > 0 ? local : remote;
  return tickHlc(deviceId, wallMs, top);
}

export interface ClampResult { hlc: Hlc; clamped: boolean; skewMs: number }

/**
 * Server rule: a client hlc whose ms is greater than serverNow + 5 minutes becomes serverNow (counter 0, same device id), and the excess is reported as skewMs.
 * An hlc inside the bound passes unchanged with skewMs equal to how far ahead it is (0 when it is not ahead).
 */
export function clampHlc(h: Hlc, serverNowMs: number): ClampResult {
  const ahead = h.ms - serverNowMs;
  if (ahead > MAX_SKEW_MS) return { hlc: { ms: serverNowMs, counter: 0, deviceId: h.deviceId }, clamped: true, skewMs: ahead };
  return { hlc: h, clamped: false, skewMs: ahead > 0 ? ahead : 0 };
}
