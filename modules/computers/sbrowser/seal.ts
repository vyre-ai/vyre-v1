// The Chrome profile of each agent in the Space browser, at rest (V1-SPEC 2.7, ARCH 6.6): while a profile's browser is not running, its Chrome folder (cookies, saved sign-ins, history) is sealed on the Space's
// own data folder and gone from the browser's volume; the first call that needs the browser puts it back. The format, the state file that survives a crash, the size cap and what this does and does not
// protect are in handlers/seal.ts. Only `chrome/` is sealed. What else sits in a profile's folder is not a sign-in: the list of sites it was signed in to (so a sleeping profile is listed without starting it),
// its start page's face and recent sites, downloads not yet taken into Files, and a fresh per-run token for the pairing with Vyre for Chrome.
//
// A sealed profile cannot be launched by anything else: after the Chrome folder is emptied the host sets a guard on the profile in browserd, which refuses to start a browser on it until the host has put the
// folder back and lifted the guard. The guard goes on BEFORE the folder is emptied, so there is no moment when an empty folder can be launched over a sealed profile. If the guard cannot be set (an image from
// before it existed, or browserd does not answer) nothing is sealed. The lock order is in handlers/seal.ts: nothing here waits for a lock or for recovery while holding a lock.
import { browserLock, checkId, createSealedStore, NoGuardError, peekTar, SEAL_CAP_BYTES, TooLargeError, UNOPENED } from "../handlers/seal.ts";
import type { SealedStore } from "../handlers/seal.ts";
import type { ProfileRow } from "./port.ts";

export interface BrowserSealDeps {
  store: SealedStore;
  /** The profile's Chrome folder as a tar whose root entry is `chrome`, as a stream; status 404 when there is none. */
  read(profileId: string): Promise<{ status: number; body: AsyncIterable<Uint8Array> & { destroy(e?: Error): unknown } }>;
  /** Put such a tar into the profile's folder; resolves with the status. */
  put(profileId: string, body: AsyncIterable<Uint8Array>): Promise<{ status: number }>;
  /** The browser of the profile stops and its Chrome folder is emptied (browserd reset_chrome). */
  reset(profileId: string): Promise<void>;
  stop(profileId: string): Promise<void>;
  /** Refuse (on) or allow (off) a browser on this profile's folder (browserd guard). */
  guard(profileId: string, on: boolean): Promise<void>;
  /** The profiles browserd knows and whether each runs. Throws when it cannot be asked: a profile that cannot be looked at is never sealed. */
  rows(): Promise<ProfileRow[]>;
  /** The profiles whose Chrome folder holds anything, with its size in bytes when browserd can say (browserd disk). The size lets a profile over the cap be skipped without reading it. */
  disk(): Promise<Array<{ id: string; bytes?: number; entries?: number }>>;
  now?: () => number;
  /** How long a profile must have been left alone, not running, before it is sealed (a viewer attaches right after a stream call). Default 20 s. */
  quietMs?: number;
  cap?: number;
  log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
}

export function createBrowserSeal(d: BrowserSealDeps) {
  const now = d.now ?? Date.now;
  const quietMs = d.quietMs ?? 20_000;
  const lock = browserLock;
  const touched = new Map<string, number>();
  const inflight = new Map<string, number>();
  /** Profiles found over the cap by reading, with the size browserd gave then (or undefined): skipped until they are used again or have shrunk. */
  const skip = new Map<string, number | undefined>();
  /** Profiles that cannot be sealed on the container as it is (no guard action in its image): kept plain, reported, tried again when the container is replaced. */
  const unguarded = new Set<string>();
  /** The size browserd gave at the last sweep, so a read that found the tar over the cap can be skipped until the folder shrinks. */
  const sizeNow = new Map<string, number>();
  const note = (msg: string, e: unknown, attrs: Record<string, unknown> = {}): void => { d.log?.("warn", msg, { ...attrs, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); };

  /** Under the lock, with the browser not running. Answers whether it sealed the profile. */
  async function sealNow(id: string): Promise<boolean> {
    const s = d.store.state(id);
    if (s === "wiping") {
      // the file is the profile and the folder is junk: it is emptied behind the guard; a container with no guard cannot do that safely, so the profile is put back instead
      try { await d.guard(id, true); } catch (e) { if (e instanceof NoGuardError) { unguarded.add(id); await plainNow(id); return false; } throw e; }
      await d.reset(id); d.store.clearState(id); return true;
    }
    if (s === "sealed") return false;
    if (s === "none") d.store.setState(id, "hot");   // before the file exists: a crash after the save still reads as plain data to seal
    // the guard goes on FIRST, before anything is read, written or changed: if the container cannot take it nothing was done and the profile stays whole, plain and startable
    try { await d.guard(id, true); } catch (e) {
      if (e instanceof NoGuardError) { if (!unguarded.has(id)) d.log?.("warn", "computers.browser.profile_not_locked_no_guard", { profile: id }); unguarded.add(id); return false; }
      throw e;
    }
    unguarded.delete(id);
    let r: Awaited<ReturnType<BrowserSealDeps["read"]>> | null = null;
    try {
      r = await d.read(id);
      let empty = r.status === 404;
      let bytes: AsyncIterable<Uint8Array> | null = null;
      if (r.status === 404) { for await (const _ of r.body) void _; }
      else if (r.status !== 200) { r.body.destroy(); throw new Error(`The browser profile could not be read (${r.status}).`); }
      else { const p = await peekTar(r.body); empty = p.empty; bytes = p.bytes; if (empty) r.body.destroy(); }
      if (empty) { d.store.discard(id); await lift(id); return false; }   // hot and empty: the person cleared it, the old file does not come back
      await d.store.saveFrom(id, bytes as AsyncIterable<Uint8Array>, d.cap, true);
    } catch (e) {
      r?.body.destroy();
      await lift(id);   // nothing was sealed: the browser must be able to start on its folder
      if (e instanceof TooLargeError) { d.store.setOversize(id, e.bytes); skip.set(id, sizeNow.get(id)); d.log?.("warn", "computers.browser.profile_too_large", { profile: id, mb: Math.round(e.bytes / 1024 ** 2) }); return false; }
      throw e;
    }
    d.store.clearOversize(id); skip.delete(id);
    d.store.setState(id, "wiping");
    await d.reset(id);
    d.store.clearState(id);
    return true;
  }

  /** Take the guard off; if browserd does not answer it is remembered on disk and lifted at the next call, so no profile stays locked. */
  async function lift(id: string): Promise<void> {
    try { await d.guard(id, false); d.store.clearLift(id); } catch { d.store.setLift(id); }
  }

  /** Under the lock. */
  async function plainNow(id: string): Promise<void> {
    const s = d.store.state(id);
    if (s === "hot") { if (d.store.needsLift(id)) { await d.guard(id, false); d.store.clearLift(id); } return; }
    if (s === "none") { d.store.setState(id, "hot"); await d.guard(id, false).catch(() => undefined); return; }
    // sealed, or wiping: the file is the profile. It is checked end to end before anything is touched.
    await d.store.verify(id);
    d.store.setState(id, "wiping");
    let rows: ProfileRow[] | null = null;
    try { rows = await d.rows(); } catch { /* cannot be asked: the browser is stopped anyway */ }
    if (rows === null || rows.some((r) => r.profileId === id && r.running)) await d.stop(id);
    await d.reset(id);
    try {
      const r = await d.put(id, d.store.open(id));
      if (r.status !== 200) throw new Error(`The browser profile could not be put back (${r.status}).`);
    } catch (e) {
      await d.reset(id).catch(() => undefined);   // the good file stays the truth; the partial copy goes
      throw e;
    }
    d.store.setState(id, "hot");
    // a guard that cannot be lifted must not leave the profile locked: the call fails, the state is hot (the folder is whole), and the next call (after a restart too) lifts it again
    try { await d.guard(id, false); } catch (e) { d.store.setLift(id); throw e; }
  }

  const self = {
    state: (id: string) => d.store.state(checkId("sbrowser", id)),
    oversize: (): string[] => d.store.oversize().map((x) => x.id),
    /** Profiles kept plain because the Space browser's image has no guard. */
    unguarded: (): string[] => [...unguarded],
    /** The container was replaced (a newer image, or a roll back): what it can do is asked again. */
    capsChanged(): void { unguarded.clear(); },
    /** Profiles whose folder may hold a plain copy (a state file). */
    pending: (): string[] => d.store.pending(),
    /**
     * Before any call that starts the profile's browser or reads its Chrome folder: the profile is put back if it was sealed; then `fn` runs with the profile marked in use, so no sweep seals it under the call.
     * A sealed file that does not open throws and nothing is touched; a restore that fails leaves the good file the truth.
     */
    async use<T>(id: string, fn: () => Promise<T>): Promise<T> {
      checkId("sbrowser", id);
      await lock(id, async () => { touched.set(id, now()); skip.delete(id); await plainNow(id); inflight.set(id, (inflight.get(id) ?? 0) + 1); });
      try { return await fn(); } finally { inflight.set(id, (inflight.get(id) ?? 1) - 1); touched.set(id, now()); }
    },
    /** Seal one profile now if its browser is not running and nothing is using it (an explicit stop passes quiet: false). A status that cannot be read means it is not sealed. */
    seal(id: string, opts: { quiet?: boolean; boot?: boolean } = {}): Promise<boolean> {
      checkId("sbrowser", id);
      return lock(id, async () => {
        if ((inflight.get(id) ?? 0) > 0) return false;
        const row = (await d.rows()).find((r) => r.profileId === id);
        if (row?.running || (row?.viewers ?? 0) > 0) return false;
        if (opts.quiet !== false && now() - Math.max(touched.get(id) ?? 0, row?.lastActiveAt ?? 0) < quietMs) return false;
        return sealNow(id);
      });
    },
    /**
     * One pass over every profile with a Chrome folder or a state file. Answers the ones sealed. A failure on one is logged and the others go on. A profile the state calls sealed that has a Chrome folder on
     * the volume is logged: it should not be there.
     */
    async sweep(opts: { quiet?: boolean; boot?: boolean } = {}): Promise<string[]> {
      const out: string[] = [];
      const onDisk = (await d.disk()).filter((x) => { try { checkId("sbrowser", x.id); return true; } catch { d.log?.("warn", "computers.browser.bad_profile_id", {}); return false; } });
      const cap = d.cap ?? SEAL_CAP_BYTES;
      for (const id of new Set([...onDisk.map((x) => x.id), ...d.store.pending()])) {
        try {
          const here = onDisk.find((x) => x.id === id);
          if (here?.bytes !== undefined) sizeNow.set(id, here.bytes);
          // over the cap: found from the size browserd gives (the tar adds up to 1 KiB per entry and 1 KiB at the end), without reading the profile, and looked at again every pass, so it is sealed once it is back under
          const est = here?.bytes === undefined ? undefined : here.bytes + (here.entries ?? 0) * 1024 + 1024;
          if (est !== undefined) {
            if (est > cap) { if (!d.store.oversize().some((x) => x.id === id)) d.log?.("warn", "computers.browser.profile_too_large", { profile: id, mb: Math.round(est / 1024 ** 2) }); d.store.setOversize(id, est); continue; }
            d.store.clearOversize(id);
          }
          // one found over the cap by reading is not read again until it is used or has shrunk
          if (skip.has(id)) { const was = skip.get(id); if (was === undefined || here?.bytes === undefined || here.bytes >= was * 0.95) continue; skip.delete(id); }
          if (unguarded.has(id)) continue;
          if (d.store.state(id) === "sealed") {
            // a plain Chrome folder beside a sealed profile is a stray (the sealed file is the profile): it is not left plain, it is emptied behind the guard
            if (here) await lock(id, async () => { if ((inflight.get(id) ?? 0) > 0 || (await d.rows()).some((r) => r.profileId === id && r.running) || d.store.state(id) !== "sealed") return; d.log?.("warn", "computers.browser.sealed_profile_has_plain_folder", { profile: id }); await d.guard(id, true); await d.reset(id); });
            continue;
          }
          if (await self.seal(id, opts)) out.push(id);
        } catch (e) { note("computers.browser.seal_failed", e, { profile: id }); }
      }
      return out;
    },
    /** At boot, before anything is served: every profile that is not running is sealed, a half-finished wipe is finished. */
    recover(): Promise<string[]> { return self.sweep({ quiet: false, boot: true }); },
    /** Chrome data is replaced (migration): `fn` empties and fills the folder under the profile's lock, and the old sealed copy is not the profile any more. */
    replace<T>(id: string, fn: () => Promise<T>): Promise<T> {
      checkId("sbrowser", id);
      return lock(id, async () => {
        let r: T;
        try { r = await fn(); } catch (e) { await d.reset(id).catch(() => undefined); throw e; }   // a failed import leaves no partial plain data
        d.store.discard(id);
        d.store.setState(id, "hot");
        await d.guard(id, false).catch(() => undefined);
        touched.set(id, now());
        return r;
      });
    },
    /** The agent is gone. */
    forgotten(id: string): Promise<void> { return lock(checkId("sbrowser", id), async () => { d.store.discard(id); skip.delete(id); unguarded.delete(id); }); },
  };
  return self;
}
export type BrowserSeal = ReturnType<typeof createBrowserSeal>;
export { createSealedStore, UNOPENED };
