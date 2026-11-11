// The Chrome profile of each agent in the Space browser, at rest (V1-SPEC 2.7, ARCH 6.6): while a profile's browser is not running, its Chrome folder (cookies, saved sign-ins, history) is sealed on the Space's
// own data folder and gone from the browser's volume; the first call that needs the browser puts it back. The format, the state file that survives a crash and the previous-generation copy are
// handlers/seal.ts, the same as an agent computer's profile disk. Only `chrome/` is sealed. What else sits in a profile's folder is not a sign-in: the list of sites it was signed in to (so a sleeping
// profile is listed without starting it), its start page's face and recent sites, downloads not yet taken into Files, and a fresh per-run token for the pairing with Vyre for Chrome.
import type { SealedStore } from "../handlers/seal.ts";
import { tarEntries, UNOPENED } from "../handlers/seal.ts";
import type { ProfileRow } from "./port.ts";

export interface BrowserSealDeps {
  store: SealedStore;
  /** The profile's Chrome folder as a tar whose root entry is `chrome`; null when there is none. */
  read(profileId: string): Promise<Uint8Array | null>;
  /** Put such a tar into the profile's folder. */
  put(profileId: string, tar: Uint8Array): Promise<void>;
  /** The browser of the profile stops and its Chrome folder is emptied (browserd reset_chrome). */
  reset(profileId: string): Promise<void>;
  stop(profileId: string): Promise<void>;
  /** The profiles browserd knows and whether each runs. */
  rows(): Promise<ProfileRow[]>;
  /** The ids of the profiles whose Chrome folder holds anything (browserd disk). */
  disk(): Promise<string[]>;
  now?: () => number;
  /** How long a profile must have been left alone, not running, before it is sealed (a viewer attaches right after a stream call). Default 20 s. */
  quietMs?: number;
  log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
}

export function createBrowserSeal(d: BrowserSealDeps) {
  const now = d.now ?? Date.now;
  const quietMs = d.quietMs ?? 20_000;
  const locks = new Map<string, Promise<unknown>>();
  const touched = new Map<string, number>();
  const tail = (id: string): Promise<unknown> => locks.get(id) ?? Promise.resolve();
  /** One thing at a time per profile: a seal never overlaps the call that needs the profile. */
  function lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = tail(id).catch(() => undefined).then(fn);
    const mine = run.catch(() => undefined);
    locks.set(id, mine);
    void mine.then(() => { if (locks.get(id) === mine) locks.delete(id); });
    return run;
  }
  let recovering: Promise<unknown> = Promise.resolve();

  async function sealNow(id: string): Promise<boolean> {
    const s = d.store.state(id);
    if (s === "wiping") { await d.reset(id); d.store.clearState(id); return true; }
    if (s === "sealed") return false;
    const tar = await d.read(id);
    if (tar === null || tarEntries(tar) === 0) { if (s === "hot") d.store.clearState(id); return false; }
    d.store.save(id, tar);
    d.store.setState(id, "wiping");
    await d.reset(id);
    d.store.clearState(id);
    return true;
  }

  return {
    state: (id: string) => d.store.state(id),
    /**
     * Before any call that starts the profile's browser or reads its Chrome folder: the profile is put back if it was sealed. A sealed file that does not open throws and nothing is touched. A browser that
     * started on its own over a sealed profile (it cannot, but a viewer's wake can) is stopped and emptied first, so what was sealed is what comes back.
     */
    plain(id: string): Promise<void> {
      return lock(id, async () => {
        await recovering;
        touched.set(id, now());
        let s = d.store.state(id);
        if (s === "hot") return;
        if (s === "wiping") { await d.reset(id); d.store.clearState(id); s = "sealed"; }
        if (s === "none") { d.store.setState(id, "hot"); return; }
        const tar = d.store.load(id);
        if ((await d.rows().catch(() => [] as ProfileRow[])).some((r) => r.profileId === id && r.running)) await d.stop(id);
        d.store.setState(id, "hot");
        await d.reset(id);
        if (tar !== null && tarEntries(tar) > 0) await d.put(id, tar);
      });
    },
    /** A call went through for this profile: it is not quiet yet. */
    touch(id: string): void { touched.set(id, now()); },
    /** Seal one profile now if its browser is not running (an explicit stop). */
    seal(id: string, opts: { quiet?: boolean; boot?: boolean } = {}): Promise<boolean> {
      return lock(id, async () => {
        if (opts.boot !== true) await recovering;
        const row = (await d.rows().catch(() => [] as ProfileRow[])).find((r) => r.profileId === id);
        if (row?.running || (row?.viewers ?? 0) > 0) return false;
        if (opts.quiet !== false && now() - Math.max(touched.get(id) ?? 0, row?.lastActiveAt ?? 0) < quietMs) return false;
        return sealNow(id);
      });
    },
    /** One pass over every profile that holds a Chrome folder. Answers the ones sealed. A failure on one is logged and the others go on. */
    async sweep(opts: { quiet?: boolean; boot?: boolean } = {}): Promise<string[]> {
      const out: string[] = [];
      for (const id of await d.disk()) {
        try { if (await this.seal(id, opts)) out.push(id); } catch (e) { d.log?.("warn", "computers.browser.seal_failed", { profile: id, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); }
      }
      return out;
    },
    /** At boot, before anything is served: every profile that is not running is sealed, a half-finished wipe is finished. */
    recover(): Promise<string[]> {
      const run = this.sweep({ quiet: false, boot: true });
      recovering = run.catch(() => undefined);
      return run;
    },
    /** Chrome data was imported (migration): the old sealed copy is not the profile any more and is not kept. */
    imported(id: string): Promise<void> {
      return lock(id, async () => { d.store.discard(id); d.store.setState(id, "hot"); touched.set(id, now()); });
    },
    /** The agent is gone. */
    forgotten(id: string): Promise<void> { return lock(id, async () => { d.store.discard(id); }); },
  };
}
export type BrowserSeal = ReturnType<typeof createBrowserSeal>;
export { UNOPENED };
