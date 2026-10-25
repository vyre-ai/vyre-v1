// Push (spec 2.24, 3.11; ARCH 7.11): device tokens, the one-device rule, and the content-free payload.
// A push carries the Space name ("Northwind needs you"), a deep link and the action keys of an approve-in-one-tap category, and nothing else: no title, body, name or value of the item.
// The host hands the module its APNs/FCM transport and its view of the computer's idle time through setPushPort at boot; with no port wired a push is recorded as not pushed and the row still lands in the app.
import { raise, meOf, render, clean } from "../projections.ts";
import type { KindDef, NotifCtx, Row } from "../projections.ts";
import { DEFAULT_PUSH_IDLE_MINUTES } from "../projections.ts";

export type Platform = "ios" | "android" | "mac" | "windows" | "web";
export interface PushMessage {
  device: string; platform: Platform; token: string;
  /** the only text of a push: the kind's pushTitle with the Space name filled in */
  title: string;
  deepLink: string;
  /** collapse id: a repeat replaces the earlier push on the device */
  tag: string;
  /** set when the kind has inline actions: the phone shows them as an action category that calls the listed capabilities with a device-bound token */
  category?: "needs_you";
  actions?: { key: string; cap: string }[];
}
export interface PushPort {
  /** "gone" means the platform said the token is dead; the module drops it. */
  send(msg: PushMessage): Promise<"ok" | "gone">;
  /** Milliseconds since the person last used a computer (app open counts as 0); undefined when no computer session is open. */
  computerIdleMs?(person: string): Promise<number | undefined>;
  spaceName?(space: string): Promise<string | undefined> | string | undefined;
  idleMinutes?(): number;
  /** One email backstop (4 hours after an approval waits); the module calls it once per approval. */
  email?(msg: { to: string; subject: string; deepLink: string }): Promise<void>;
}
let port: PushPort | null = null;
/** Called by the host at boot (null at shutdown and in tests). */
export function setPushPort(p: PushPort | null): void { port = p; }
export const pushPort = (): PushPort | null => port;

const PLATFORMS = new Set(["ios", "android", "mac", "windows", "web"]);
const PHONES = new Set(["ios", "android"]);
const SCOPE = "notifications.push";

function storeToken(ctx: NotifCtx, token: string): string {
  if (!ctx.seal) return JSON.stringify({ plain: token });
  return JSON.stringify({ sealed: ctx.seal.seal(new TextEncoder().encode(token), SCOPE) });
}
function openToken(ctx: NotifCtx, stored: string): string | undefined {
  try {
    const v = JSON.parse(stored) as { plain?: string; sealed?: { keyId: string; nonce: string; bytes: string } };
    if (typeof v.plain === "string") return v.plain;
    if (v.sealed && ctx.seal) return new TextDecoder().decode(ctx.seal.unseal(v.sealed));
  } catch { /* a token we cannot read is as good as gone */ }
  return undefined;
}

export async function pushRegister(ctx: NotifCtx, input: { device: string; platform: string; token: string }): Promise<{ registered: boolean }> {
  if (!PLATFORMS.has(input.platform)) raise(ctx, "validation.bad_input", "That platform cannot receive pushes.", { errors: ["/platform: unknown"] });
  const token = input.token.trim();
  if (!token || token.length > 4096) raise(ctx, "validation.bad_input", "The push token is empty or too long.", { errors: ["/token: 1 to 4096 characters"] });
  const person = meOf(ctx);
  // a device belongs to whoever signed in on it last: the row is replaced, never shared
  ctx.db.run(
    `INSERT INTO notifications_push (device, person, platform, token, registered_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(device) DO UPDATE SET person = excluded.person, platform = excluded.platform, token = excluded.token, registered_at = excluded.registered_at`,
    input.device, person, input.platform, storeToken(ctx, token), ctx.now(),
  );
  // the event names the device and platform; the token value is never in it
  ctx.emit("notification.push_registered", `entity/${input.device}`, { person, device: input.device, platform: input.platform }, { vis: "owner" });
  return { registered: true };
}

export async function pushUnregister(ctx: NotifCtx, input: { device: string }): Promise<{ removed: boolean }> {
  const r = ctx.db.run("DELETE FROM notifications_push WHERE device = ? AND person = ?", input.device, meOf(ctx));
  return { removed: r.changes > 0 };
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** The whole push for a notification. Nothing from the row's title or body goes in. */
export function buildPush(row: Row, def: KindDef, spaceName: string): Omit<PushMessage, "device" | "platform" | "token"> {
  const deepLink = row.subject ? `vyre://${encodeURIComponent(row.subject.type)}/${encodeURIComponent(row.subject.id)}` : `vyre://${row.place}`;
  const title = render(def.pushTitle ?? "{{space}} needs you", { space: spaceName });
  return clean({
    title, deepLink, tag: (row.collapseKey ?? row.id).slice(0, 120),
    ...(def.actions.length ? { category: "needs_you" as const, actions: def.actions.map((a) => ({ key: slug(a.label), cap: a.cap })) } : {}),
  }) as Omit<PushMessage, "device" | "platform" | "token">;
}

/** One device at a time: the computer while the person is on it, the phone after the idle time, the computer's own token only when there is no phone. */
export async function deliverPush(ctx: NotifCtx, person: string, row: Row, def: KindDef): Promise<{ pushed: boolean; device?: string }> {
  const p = port;
  if (!p) return { pushed: false };
  const idleMs = p.computerIdleMs ? await p.computerIdleMs(person).catch(() => undefined) : undefined;
  const idleNeeded = (p.idleMinutes?.() ?? DEFAULT_PUSH_IDLE_MINUTES) * 60_000;
  if (idleMs !== undefined && idleMs < idleNeeded) return { pushed: false };   // the app is open: the banner is the notification
  const devices = ctx.db.all("SELECT device, platform, token FROM notifications_push WHERE person = ? ORDER BY registered_at DESC, device", person) as { device: string; platform: Platform; token: string }[];
  const target = devices.find((d) => PHONES.has(d.platform)) ?? devices[0];
  if (!target) return { pushed: false };
  const token = openToken(ctx, target.token);
  if (!token) { ctx.db.run("DELETE FROM notifications_push WHERE device = ?", target.device); return { pushed: false }; }
  const name = (await p.spaceName?.(ctx.space)) ?? "Vyre";
  try {
    const res = await p.send({ device: target.device, platform: target.platform, token, ...buildPush(row, def, name) });
    if (res === "gone") { ctx.db.run("DELETE FROM notifications_push WHERE device = ?", target.device); return { pushed: false }; }
    return { pushed: true, device: target.device };
  } catch (e) {
    ctx.log?.warn("push transport failed", (e as Error).message);
    return { pushed: false };
  }
}
