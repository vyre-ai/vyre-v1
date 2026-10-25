// How one kind of notification reaches me (spec 2.24 "Settings only adjusts"; the prototype's Notify me on rows). A person picks channels (desktop, phone, email) per kind; desktop or phone
// means Interrupt, otherwise Badge. send() reads the choice through levelOverride, so away, working hours and the agent cap still apply on top.
import { UNMUTABLE_KINDS, clean, kindOf, meOf, raise } from "../projections.ts";
import type { Db, KindDef, Level, NotifCtx } from "../projections.ts";

export type Channel = "desktop" | "phone" | "email";
const CHANNELS: readonly Channel[] = ["desktop", "phone", "email"];
const RANK: Record<Level, number> = { digest: 0, badge: 1, interrupt: 2 };

export interface KindChoice { level: Level; channels: Channel[] }

export function readChoice(db: Db, person: string, kind: string): KindChoice | undefined {
  const r = db.all("SELECT level, channels FROM notifications_kind_levels WHERE person = ? AND kind = ?", person, kind)[0] as { level: Level; channels: string } | undefined;
  if (!r) return undefined;
  let channels: Channel[] = [];
  try { channels = (JSON.parse(r.channels) as Channel[]).filter((c) => CHANNELS.includes(c)); } catch { /* an unreadable list is no channels */ }
  return { level: r.level, channels };
}

/** The level send() starts from for this person: their own choice for the kind, else the kind's shipped level. */
export function levelOverride(db: Db, person: string, def: KindDef): Level {
  return readChoice(db, person, def.key)?.level ?? def.level;
}

export async function kindSetLevel(ctx: NotifCtx, input: { kind: string; level?: Level; channels?: Channel[] }): Promise<{ kind: string; level: Level; channels: Channel[] }> {
  const me = meOf(ctx);
  const def = kindOf(input.kind);
  if (!def || input.kind === "vault.rotation_due") raise(ctx, "validation.bad_input", "That kind of notification does not exist.", { errors: ["/kind: unknown"] });
  if (input.level === undefined && input.channels === undefined) raise(ctx, "validation.bad_input", "Say a level, channels, or both.", { errors: ["/level: give a level or channels"] });
  const was = readChoice(ctx.db, me, def!.key);
  const channels = input.channels !== undefined ? [...new Set(input.channels)].sort((a, b) => CHANNELS.indexOf(a) - CHANNELS.indexOf(b)) : (was?.channels ?? []);
  const loud = channels.includes("desktop") || channels.includes("phone");
  const level: Level = input.level ?? (input.channels !== undefined ? (loud ? "interrupt" : "badge") : (was?.level ?? def!.level));
  if (level === "digest" && channels.length > 0) raise(ctx, "validation.bad_input", "A digest kind carries no channels.", { errors: ["/channels: must be empty at digest"] });
  if (level !== "interrupt" && loud) raise(ctx, "validation.bad_input", "Desktop and phone carry Interrupt only.", { errors: ["/channels: desktop and phone need level interrupt"] });
  if (UNMUTABLE_KINDS.has(def!.key) && RANK[level] < RANK.interrupt) raise(ctx, "validation.precondition_failed", "This reminder always interrupts.", { reason: "kind_not_lowerable" });
  if (!was || was.level !== level || JSON.stringify(was.channels) !== JSON.stringify(channels)) {
    ctx.db.run(
      `INSERT INTO notifications_kind_levels (person, kind, level, channels) VALUES (?, ?, ?, ?)
       ON CONFLICT(person, kind) DO UPDATE SET level = excluded.level, channels = excluded.channels`, me, def!.key, level, JSON.stringify(channels),
    );
    ctx.emit("notification.rules_changed", `entity/${me}`, { person: me, fields: [`kind:${def!.key}`] }, { vis: "owner" });
  }
  return clean({ kind: def!.key, level, channels }) as { kind: string; level: Level; channels: Channel[] };
}
