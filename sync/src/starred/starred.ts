// Star and Follow on the device (spec 2.23, ARCH 5.11). `star` and `follow` are synced entities in every profile (desktop, phone, web), owned by the person, so each device holds all of its person's stars and follows.
// This layer turns those rows into the replica's keep flags (a phone keeps a starred row whatever its age and admits a starred or followed record it does not own) and gives the UI an optimistic toggle:
//   toggle   writes the star or follow row and queues stars.toggle / follows.toggle in one transaction, then sets the flags at once, offline included
//   onRow    a star or follow row arrived from the server (or was removed): set or clear the flags, so a toggle on another device converges here
//   refresh  rebuild the flags from the rows after open or a resync
// Rule inputs: following() lists what the person follows (Inbox visibility uses Follow only); starred() lists the Home and sidebar Starred section.
import type { ReplicaStore, SqlDriver } from "../replica/index.ts";

export interface Resource { type: string; id: string }

/** Resource type to replica entity key, where they differ from the type name. Records are found by id (see `recordEntities`). */
const ENTITY_OF: Readonly<Record<string, string>> = Object.freeze({
  channel: "thread", thread: "thread", file: "file", folder: "folder", calendar: "calendar", inbox: "mailbox", mailbox: "mailbox",
  agent: "agent", run: "run", number: "number", vault_item: "vault_meta", vault_folder: "vault_meta",
});

export interface StarredOpts {
  store: ReplicaStore;
  person: string;
  actor: string;
  clock?: () => number;
  /** A fresh hybrid logical clock for a local write. */
  hlc: () => string;
  /** Op and trace ids for the queued capability call. */
  newId: () => string;
  newTrace: () => string;
  /** Entity keys of record types to probe when a starred resource is a record. */
  recordEntities?: () => readonly string[];
}

export interface Starred {
  isStarred(r: Resource): boolean;
  isFollowing(r: Resource): boolean;
  starred(): Resource[];
  following(): Resource[];
  /** Star or unstar. Starring a person or company may also follow (`alsoFollow`). */
  toggleStar(r: Resource, on: boolean, alsoFollow?: boolean): void;
  toggleFollow(r: Resource, on: boolean): void;
  /** A star or follow row arrived or changed through sync. */
  onRow(entity: "star" | "follow", row: { person?: unknown; resourceType?: unknown; resourceId?: unknown; deleted_at?: unknown }): void;
  /** Rebuild every flag from the star and follow rows of the person. */
  refresh(driver: SqlDriver): void;
  /** Re-apply the flags to rows that arrived after their star did (run after applying a pull page). */
  recheck(): void;
}

const keyOf = (r: Resource): string => `${r.type}\u0000${r.id}`;
const rowId = (prefix: string, r: Resource): string => `${prefix}${r.type}.${r.id}`;

export function createStarred(o: StarredOpts): Starred {
  const now = o.clock ?? Date.now;
  const stars = new Map<string, Resource>();
  const follows = new Map<string, Resource>();

  /** The replica entities the resource may live in. A record not on this device yet could be any record type, so every type gets the flag: a flag on an id that never arrives costs one row. */
  function entitiesOf(r: Resource): readonly string[] {
    const mapped = ENTITY_OF[r.type];
    if (mapped) return [mapped];
    if (r.type !== "record") return [r.type];
    const all = o.recordEntities?.() ?? [];
    const here = all.filter((e) => o.store.read(e, r.id) !== null);
    return here.length ? here : all;
  }

  /** Set the flag now, so a row that arrives later is admitted, and a row already here is kept. */
  function flag(r: Resource, kind: "starred" | "follows", on: boolean): void {
    for (const e of entitiesOf(r)) o.store.keep(e, r.id, { [kind]: on });
  }

  function recheck(): void {
    for (const r of stars.values()) flag(r, "starred", true);
    for (const r of follows.values()) flag(r, "follows", true);
  }

  function write(entity: "star" | "follow", r: Resource, on: boolean, cap: string, input: unknown): void {
    const at = now();
    o.store.write({
      entity, id: rowId(entity === "star" ? "str_" : "flw_", r),
      fields: { person: o.person, resourceType: r.type, resourceId: r.id, createdAt: at, deleted_at: on ? null : at },
      hlc: o.hlc(), actor: o.actor, origin: "local",
      op: { opId: o.newId(), traceId: o.newTrace(), cap, v: 1, input: JSON.stringify(input), baseSeq: "{}" },
    });
  }

  function set(map: Map<string, Resource>, r: Resource, on: boolean): void {
    if (on) map.set(keyOf(r), r); else map.delete(keyOf(r));
  }

  return {
    recheck,
    isStarred: (r) => stars.has(keyOf(r)),
    isFollowing: (r) => follows.has(keyOf(r)),
    starred: () => [...stars.values()],
    following: () => [...follows.values()],
    toggleStar(r, on, alsoFollow) {
      write("star", r, on, "stars.toggle", { resource: r, on, ...(alsoFollow !== undefined ? { alsoFollow } : {}) });
      set(stars, r, on);
      flag(r, "starred", on);
      // The server writes the follow row for "Also follow"; this device shows it at once.
      if (on && alsoFollow === true && !follows.has(keyOf(r))) { set(follows, r, true); flag(r, "follows", true); }
    },
    toggleFollow(r, on) {
      write("follow", r, on, "follows.toggle", { resource: r, on });
      set(follows, r, on);
      flag(r, "follows", on);
    },
    onRow(entity, row) {
      if (typeof row.resourceType !== "string" || typeof row.resourceId !== "string") return;
      if (row.person !== undefined && row.person !== o.person) return;
      const r: Resource = { type: row.resourceType, id: row.resourceId };
      const on = row.deleted_at === null || row.deleted_at === undefined;
      if (entity === "star") { set(stars, r, on); flag(r, "starred", on); } else { set(follows, r, on); flag(r, "follows", on); }
    },
    refresh(driver) {
      stars.clear();
      follows.clear();
      for (const [table, map] of [["spaces_star", stars], ["spaces_follow", follows]] as const) {
        for (const row of driver.prepare(`SELECT resourceType, resourceId FROM ${table} WHERE person = ? AND deleted_at IS NULL`).all([o.person])) {
          if (typeof row["resourceType"] === "string" && typeof row["resourceId"] === "string") map.set(keyOf({ type: row["resourceType"], id: row["resourceId"] }), { type: row["resourceType"], id: row["resourceId"] });
        }
      }
      recheck();
    },
  };
}
