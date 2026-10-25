// bootCore(): a Space with the frozen `core` seed, in a few milliseconds when the template is cached. Built from the event log and the access projection only.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { LogStore } from "../../../kernel/src/log/store.ts";
import { buildSnapshot } from "./access.ts";
import { cacheDir, copyTemplate, ensureTemplate, templateKey } from "./cache.ts";
import { CORE_SPACE, coreEvents } from "./recipe.ts";

export * from "./recipe.ts";
export { applyEvent, buildSnapshot } from "./access.ts";
export { cacheDir, ensureTemplate, templateKey } from "./cache.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");
/** The files whose content defines the seed. */
export const CORE_SOURCES: readonly string[] = [path.join(HERE, "recipe.ts"), path.join(HERE, "access.ts"), path.join(REPO, "kernel/src/grants/roles.ts"), path.join(REPO, "kernel/src/authorize/roles.ts"), path.join(REPO, "manifests/permissions.ts")];
export const registryHash = (): string => fs.readFileSync(path.join(REPO, "generated/hash.txt"), "utf8").trim();

/** The wall time the template is built at, so the same recipe makes the same envelopes. */
const TEMPLATE_TIME = 1_790_000_000_000;

export interface BootOptions { cache?: string; scratch?: string; sources?: readonly string[]; registry?: string }
export interface CoreSpace {
  space: string;
  store: LogStore;
  snapshot: AccessSnapshot;
  /** Was the template already cached? */
  hit: boolean;
  key: string;
  file: string;
  close(): void;
}

export function bootCore(o: BootOptions = {}): CoreSpace {
  const key = templateKey(o.sources ?? CORE_SOURCES, o.registry ?? registryHash());
  const tpl = ensureTemplate(o.cache ?? cacheDir(), "core", key, (file) => {
    const store = new LogStore({ db: new DatabaseSync(file), space: CORE_SPACE, clock: () => TEMPLATE_TIME });
    for (const r of store.appendBatch(coreEvents())) if (!r.ok) throw new Error(`seed event refused: ${r.message}`);
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    store.close();
  });
  const scratch = o.scratch ?? os.tmpdir();
  const file = copyTemplate(tpl, scratch);
  const store = new LogStore({ db: new DatabaseSync(file), space: CORE_SPACE });
  const snapshot = buildSnapshot(store.read({ limit: 5000 }));
  return { space: CORE_SPACE, store, snapshot, hit: tpl.hit, key, file, close: () => { store.close(); fs.rmSync(file, { force: true }); fs.rmSync(`${file}-wal`, { force: true }); fs.rmSync(`${file}-shm`, { force: true }); } };
}
