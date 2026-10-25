// The kits module's host seam (rulings 31 and 32): the module exports `hostSeams = { setKitsHost }` and the daemon hands it the Kit source it reads the Kits this server ships from.
// The host never imports the module, so the shape below is the structural subset of the module's KitsConfig that the host supplies.
// A shipped Kit is the folder kits/<key>/kit.json under the code root (kits.yml tested every version in CI). Working copies live in the Space's Kit folders, which the files module owns;
// until a Space has one, `working` answers null and the module reports "no working copy" itself.
import fs from "node:fs";
import path from "node:path";

export interface KitsHostSource {
  catalog(): Promise<unknown[]>;
  read(key: string, version: string): Promise<unknown | null>;
  working(key: string): Promise<unknown | null>;
}
export interface KitsHostSeam { source: KitsHostSource; resources?: { ensure(kitId: string): Promise<void> } }

const KEY = /^[a-z][a-z0-9_.-]{0,60}$/;

/** Reads every kits/<key>/kit.json under `root`. A folder with no kit.json, or one that is not JSON, is skipped (the module checks the rest and warns about a Kit that fails its own check). */
export function createKitsHost(deps: { root: string; resources?: { ensure(kitId: string): Promise<void> } }): KitsHostSeam {
  const dir = path.join(deps.root, "kits");
  const load = (): { key: string; raw: unknown }[] => {
    let names: string[];
    try { names = fs.readdirSync(dir).sort(); } catch { return []; }
    const out: { key: string; raw: unknown }[] = [];
    for (const key of names) {
      if (!KEY.test(key)) continue;
      try { out.push({ key, raw: JSON.parse(fs.readFileSync(path.join(dir, key, "kit.json"), "utf8")) as unknown }); } catch { /* not a Kit folder */ }
    }
    return out;
  };
  return {
    ...(deps.resources ? { resources: deps.resources } : {}),
    source: {
      catalog: () => Promise.resolve(load().map((k) => k.raw)),
      read: (key, version) => {
        const hit = load().find((k) => { const o = k.raw as { key?: unknown; version?: unknown } | null; return o?.key === key && o?.version === version; });
        return Promise.resolve(hit ? hit.raw : null);
      },
      working: () => Promise.resolve(null),
    },
  };
}
