// The Space record store (packet P-H_08). Until now each L3 data module (records, schema, sources, connectors) opened its own private ":memory:" store on its first call, so
// everything it wrote was lost at restart and the four never saw one another's types. The host now opens ONE store (one ProjectionHost over one SQLite file in the data
// directory) and hands it to each of them through a setter the module exports in `hostSeams` (ruling 31). Host never imports a module (layer rule), so a module that needs an
// extra inline projection on that store (records: per-field clocks) names it with `declare` while the daemon wires seams at boot; the store is opened lazily on the first
// `open`, which is always after boot, so the order the four setters run in does not matter. Declaring after the store is open is an error, not a silent skip.
import path from "node:path";
import type { ProjectionHost, InlineProjection, Tx } from "../../../kernel/src/store/projection.ts";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import type { Store } from "../../../kernel/src/store/types.ts";
import type { SeamDriver } from "../seams/index.ts";

export interface SpaceStoreHandle { host: ProjectionHost; store: Store; tx: Tx }

/** What a data module receives. */
export interface SpaceStoreSeam {
  readonly path: string;
  readonly space: string;
  /** Name inline projections the module needs on the shared store. Only before the first `open`. */
  declare(extra: readonly InlineProjection[]): void;
  /** The one store of this Space (the same object for every caller). */
  open(): SpaceStoreHandle;
  /** True when a module call's `ctx.db` belongs to the daemon that owns this store (a db that cannot be told apart counts as ours). Lets a module serving two daemons of one process pick the right store. */
  ours?(db: unknown): boolean;
  /** True once the Space store is closed (its daemon stopped). */
  closed?(): boolean;
}

export interface SpaceStore extends SpaceStoreSeam {
  isOpen(): boolean;
  close(): void;
}

/** The setters the four data modules export; each is a distinct name because two modules may not offer the same setter. */
export const SPACE_STORE_SETTERS = ["setRecordsSpaceStore", "setSchemaSpaceStore", "setSourcesSpaceStore", "setConnectorsSpaceStore"] as const;

export const spaceStorePath = (root: string): string => path.join(root, "space.db");

export function createSpaceStore(o: { path: string; space: string; ours?: (db: unknown) => boolean }): SpaceStore {
  const extras: InlineProjection[] = [];
  let opened: SpaceStoreHandle | null = null;
  let closed = false;
  return {
    path: o.path,
    space: o.space,
    ...(o.ours ? { ours: o.ours } : {}),
    closed: () => closed,
    declare(extra) {
      if (opened) throw new Error("A module declared a projection after the Space store was opened.");
      for (const p of extra) if (!extras.some((x) => x.name === p.name)) extras.push(p);
    },
    open() {
      if (closed) throw new Error("The Space store is closed.");
      if (!opened) {
        const r = openRecordStore({ path: o.path, space: o.space, extra: extras });
        opened = { host: r.host, store: r.store, tx: r.host.tx };
      }
      return opened;
    },
    isOpen: () => opened !== null,
    close() {
      if (closed) return;
      closed = true;
      opened?.host.close();
      opened = null;
    },
  };
}

/** One driver per setter, all giving the same store. */
export function spaceStoreDrivers(store: SpaceStoreSeam): Record<string, SeamDriver> {
  return Object.fromEntries(SPACE_STORE_SETTERS.map((n) => [n, (() => store) as SeamDriver]));
}

/**
 * What a data module keeps for the Space store(s) it was handed. A module's seam setter is called once per daemon, and two daemons can share a process (two Space links in the desktop app, the
 * two-computer tests), so the module cannot hold one value: it keeps the stores handed to it and, for each call, picks the one whose daemon the call's `ctx.db` belongs to. A stopped daemon's store
 * is never picked. With no store at all (a unit test) `build(null)` makes the module's private one. `build` runs once per store.
 */
export function perSpaceStore<T>(build: (seam: SpaceStoreSeam | null) => T, onSet?: (seam: SpaceStoreSeam) => void): { set(seam: SpaceStoreSeam | null): void; get(ctx?: { db?: unknown }): T } {
  const seams: SpaceStoreSeam[] = [];
  const built = new Map<SpaceStoreSeam | null, T>();
  const pick = (ctx?: { db?: unknown }): SpaceStoreSeam | null => {
    const live = seams.filter((x) => !x.closed?.());
    const mine = ctx?.db !== undefined ? [...live].reverse().find((x) => x.ours?.(ctx.db)) : undefined;
    return mine ?? live.at(-1) ?? null;
  };
  return {
    set(seam) {
      for (let i = seams.length - 1; i >= 0; i--) if (seams[i]!.closed?.()) { built.delete(seams[i]!); seams.splice(i, 1); }
      if (seam && !seams.includes(seam)) { seams.push(seam); onSet?.(seam); }
    },
    get(ctx) {
      const k = pick(ctx);
      if (!built.has(k)) built.set(k, build(k));
      return built.get(k) as T;
    },
  };
}
