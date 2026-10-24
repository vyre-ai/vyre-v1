// Test world for updates: a handler ctx over the in-memory SQL engine (behind the host's table guard), a signed release feed with a real Ed25519 key pair,
// an installer that records what it was asked to do, and a stand-in for the backup module's capabilities.

import { scopedDb } from "../../../host/src/ctx/db.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { FakeUpdatesDb, NOW, SPACE, TRACE } from "./db.ts";
import { SIGNATURE_PREFIX } from "../handlers/channels.ts";
import type { Channel, Installer, ReleaseFeed, ReleaseInfo, SignedManifest, UpdateCtx, UpdateDrivers } from "../handlers/channels.ts";

export { NOW, SPACE, TRACE };

const enc = new TextEncoder();
const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
const own = (d: Uint8Array) => { const o = new Uint8Array(new ArrayBuffer(d.byteLength)); o.set(d); return o; };

export interface KeyPair { publicKey: Uint8Array; sign(manifest: string): Promise<string> }

/** A fresh Ed25519 key pair; sign() makes the detached base64 signature over the prefix and the manifest text, as the release workflow does. */
export async function keyPair(): Promise<KeyPair> {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as unknown as { publicKey: never; privateKey: never };
  const publicKey = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey,
    async sign(manifest) {
      return b64(new Uint8Array(await globalThis.crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, own(enc.encode(SIGNATURE_PREFIX + manifest)))));
    },
  };
}

export const SHA = "a".repeat(64);

export interface ManifestOptions { channel?: Channel; version: string; notes?: string; security?: boolean; apps?: Record<string, string>; v?: number; sha256?: string }

export function manifestText(o: ManifestOptions): string {
  return JSON.stringify({
    v: o.v ?? 1, channel: o.channel ?? "stable",
    server: { version: o.version, tarball: `https://releases.example/vyre-${o.version}.tgz`, sha256: o.sha256 ?? SHA, ...(o.notes ? { notes: o.notes } : {}), ...(o.security ? { security: true } : {}) },
    apps: o.apps ?? {}, kits: { default: "1.0.0" }, connectors: { default: "1.0.0" },
  });
}

export interface FakeFeed extends ReleaseFeed {
  /** what the feed answers for each channel, until replaced */
  answers: Map<Channel, SignedManifest>;
  asked: Channel[];
  down: boolean;
}

export interface FakeInstaller extends Installer {
  version: string;
  kept: string[];
  log: string[];
  /** make install throw this message */
  installFails: string | null;
  /** health answers, taken in order; after they run out the installer answers healthy */
  health: boolean[];
  switchFails: boolean;
}

export interface Backups {
  /** what backup.run answers; null makes it throw */
  runs: { backupId: string }[];
  listed: string[];
  runError: string | null;
  calls: string[];
}

export interface World {
  raw: FakeUpdatesDb;
  ctx: UpdateCtx;
  key: KeyPair;
  feed: FakeFeed;
  installer: FakeInstaller;
  backups: Backups;
  drivers: UpdateDrivers;
  events: { name: string; subject: string; payload: unknown }[];
  /** publish a signed manifest on a channel */
  publish(o: ManifestOptions): Promise<void>;
  setNow(n: number): void;
}

export async function world(o: { version?: string } = {}): Promise<World> {
  const raw = new FakeUpdatesDb();
  const key = await keyPair();
  const events: World["events"] = [];
  const feed: FakeFeed = {
    answers: new Map(), asked: [], down: false,
    async fetch(channel) {
      feed.asked.push(channel);
      if (feed.down) throw new Error("the feed is unreachable");
      const a = feed.answers.get(channel);
      if (!a) throw new Error(`no release on ${channel}`);
      return a;
    },
  };
  const installer: FakeInstaller = {
    version: o.version ?? "1.2.0", kept: ["1.1.0", "1.0.0"], log: [], installFails: null, health: [], switchFails: false,
    async current() { return installer.version; },
    async previous() { return installer.kept.slice(); },
    async install(r: ReleaseInfo) {
      installer.log.push(`install ${r.version}`);
      if (installer.installFails) throw new Error(installer.installFails);
      installer.kept = [installer.version, ...installer.kept];
      installer.version = r.version;
    },
    async healthy() { const h = installer.health.shift(); return h === undefined ? true : h; },
    async switchTo(v) {
      installer.log.push(`switch ${v}`);
      if (installer.switchFails) throw new Error("the switch failed");
      installer.version = v;
    },
  };
  const backups: Backups = { runs: [{ backupId: "bkp_first1" }], listed: ["bkp_first1"], runError: null, calls: [] };
  let clock = NOW;
  let runs = 0;
  const ctx = {
    space: SPACE,
    principal: { kind: "person", id: "usr_admin" },
    trace: { traceId: TRACE, spanId: "abcdef0123456789" },
    now: () => clock,
    db: scopedDb("updates", raw, TRACE),
    emit: ((name: string, subject: string, payload: unknown) => { events.push({ name, subject, payload }); return {} as never; }) as unknown as Ctx["emit"],
    call: (async (cap: string, _input: unknown) => {
      backups.calls.push(`${cap}@${installer.log.length}`);
      if (cap === "backup.run") {
        if (backups.runError) throw new Error(backups.runError);
        const r = backups.runs.shift();
        return r ?? { backupId: "bkp_none" };
      }
      if (cap === "backup.list") return { backups: backups.listed.map((backupId) => ({ backupId })), total: backups.listed.length };
      throw fail("internal.not_implemented", TRACE, { details: { cap } });
    }) as unknown as Ctx["call"],
    // each capability call is its own run, as in the pipeline: the id changes every time a handler asks for it
    get run() { runs += 1; return `run_testrun${runs}`; },
  } as unknown as UpdateCtx;
  const drivers: UpdateDrivers = { feed, releaseKey: key.publicKey, installer };
  return {
    raw, ctx, key, feed, installer, backups, drivers, events,
    async publish(m) {
      const text = manifestText(m);
      feed.answers.set(m.channel ?? "stable", { manifest: text, signature: await key.sign(text) });
    },
    setNow(n) { clock = n; },
  };
}
