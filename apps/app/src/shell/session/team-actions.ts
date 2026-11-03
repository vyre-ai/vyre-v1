// The Space menu's acts that reach the Space (audit 3 Nov, owner D23): Invite People and Set Yourself Away. Pure of React: the shell host passes the call and the hub.
//   Invite People   makes a one-time invite for a Member that lasts 7 days and copies its link. It starts them where the Space starts everyone (#vyre and what is shared with Everyone);
//                   Console > People makes one with a different role, groups, channels, projects or agents.
//   Away            stored (notifications.away.set, until you press I'm Back), so teammates see a steady away dot and approvals wait; I'm Back clears it and writes the digest.
export const INVITE_ROLE = "rol_member";
export const INVITE_DAYS = 7;
/** "Until I'm Back": away holds until the person clears it; the store needs an end, so it is far off. */
export const AWAY_HOLD_MS = 30 * 24 * 3_600_000;

type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface TeamHub { flash(text: string): void; setAway(on: boolean): void }
export interface Clipboard { writeText(text: string): Promise<void> }

const clipboard = (): Clipboard | undefined => (globalThis as { navigator?: { clipboard?: Clipboard } }).navigator?.clipboard;
const reason = (e: unknown): string => (e instanceof Error && e.message ? e.message : "try again");
const key = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export function teamActions(o: { call: Call; hub: TeamHub; space: string; now?: () => number; clip?: () => Clipboard | undefined }): { invite(): Promise<string | null>; away(on: boolean): Promise<void>; load(): Promise<boolean> } {
  const now = o.now ?? Date.now;
  const clip = o.clip ?? clipboard;
  return {
    async invite() {
      let link: string;
      try {
        const out = (await o.call("members.invites.create", { role: INVITE_ROLE, expiresInDays: INVITE_DAYS, idempotencyKey: key() })) as { link: string };
        link = out.link;
      } catch (e) { o.hub.flash(`Couldn't make an invite link: ${reason(e)}`); return null; }
      try {
        const c = clip();
        if (!c) throw new Error("no clipboard");
        await c.writeText(link);
      } catch {
        o.hub.flash(`Couldn't copy the invite link. Copy it from Console, People: ${link}`);
        return link;
      }
      o.hub.flash(`Invite link copied. One person can join ${o.space} with it as a Member for ${INVITE_DAYS} days.`);
      return link;
    },
    async away(on) {
      try {
        if (on) await o.call("notifications.away.set", { until: now() + AWAY_HOLD_MS, delegate: { kind: "none" } });
        else await o.call("notifications.away.clear", {});
      } catch (e) { o.hub.flash(`Couldn't change away: ${reason(e)}`); return; }
      o.hub.setAway(on);
      o.hub.flash(on ? "You are away. Teammates see it, and only calls interrupt you." : "Welcome back");
    },
    async load() {
      try {
        const out = (await o.call("notifications.away.get", {})) as { away?: boolean };
        const away = out.away === true;
        o.hub.setAway(away);
        return away;
      } catch { return false; }
    },
  };
}
