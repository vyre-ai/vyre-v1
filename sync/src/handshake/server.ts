// Server side of the handshake (ARCH 5.2). `hello` answers a device and remembers what it said: the app version, the registry hash and the mode it was given. A device in update_required mode may read and
// pull but not write: `assertCanWrite` refuses its push before anything is applied, and `guardPushDeps` is the same rule one level down, so an op that gets through to the capability still cannot write.
// Refused ops come back in `rejected` with their values (copyOut), so what the person typed on the old app is not lost.
// The ledger is one row per person and device in `sync_hello`, created on first use; it survives a restart, so a server that comes back still knows which devices are read-only.
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { parseHello } from "../protocol.ts";
import type { Hello, Mode, ServerState } from "../protocol.ts";
import type { PushDeps } from "../server/push/index.ts";
import { decideHello } from "./decide.ts";
import { updateRequiredError } from "./errors.ts";
import type { HandshakeResult } from "./decide.ts";
import type { ReleaseTable } from "./releases.ts";

export interface HandshakeDeps {
  db: Tx;
  /** The server's state for this person and device (epoch, head, registry hashes, entity versions), as the live hub builds it. */
  state(who: HelloWho): ServerState;
  /** The releases and their registry hashes. */
  releases?: () => ReleaseTable;
  now(): number;
}

export interface HelloWho { person: string; device: string }

export interface SeenDevice { person: string; device: string; appVersion: string; registryHash: string; mode: Mode; at: number }

export interface Handshake {
  /** Validate and answer a hello, and remember the answer. A malformed hello throws validation.bad_input. */
  hello(who: HelloWho, raw: unknown, traceId: string): HandshakeResult;
  /** False for a device whose last hello was update_required. A device that never said hello may write (a plain HTTP client). */
  canWrite(person: string, device: string): boolean;
  /** Throws permission.update_required for a read-only device. */
  assertCanWrite(person: string, device: string, traceId: string): void;
  seen(person: string, device: string): SeenDevice | undefined;
  /** A device was revoked or removed. */
  forget(person: string, device: string): void;
  /** The push dependencies with the read-only rule added to invoke. */
  guardPushDeps(deps: PushDeps): PushDeps;
}

const DDL = "CREATE TABLE IF NOT EXISTS sync_hello (person TEXT NOT NULL, device TEXT NOT NULL, app_version TEXT NOT NULL, registry_hash TEXT NOT NULL, mode TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (person, device)) WITHOUT ROWID;";

export function createHandshake(d: HandshakeDeps): Handshake {
  const ready = { done: false };
  const ensure = (): void => { if (!ready.done) { d.db.exec(DDL); ready.done = true; } };

  const seen = (person: string, device: string): SeenDevice | undefined => {
    ensure();
    const r = d.db.get<{ app_version: string; registry_hash: string; mode: string; at: number }>("SELECT app_version, registry_hash, mode, at FROM sync_hello WHERE person = ? AND device = ?", person, device);
    return r ? { person, device, appVersion: r.app_version, registryHash: r.registry_hash, mode: r.mode as Mode, at: r.at } : undefined;
  };
  const canWrite = (person: string, device: string): boolean => seen(person, device)?.mode !== "update_required";
  const assertCanWrite = (person: string, device: string, traceId: string): void => {
    const s = seen(person, device);
    if (s?.mode === "update_required") throw updateRequiredError(traceId, s.appVersion);
  };

  return {
    hello(who, raw, traceId) {
      const p = parseHello(raw);
      if (!p.ok) throw new VyreErr({ code: "validation.bad_input", message: "The hello is not valid.", retryable: false, traceId, next: [{ kind: "update_app", label: "Update the app" }], details: { why: p.error } });
      const h: Hello = p.value;
      if (h.deviceId !== who.device) throw new VyreErr({ code: "validation.bad_input", message: "The hello names a different device than the session.", retryable: false, traceId, next: [{ kind: "reconnect", label: "Sign in again on this device" }] });
      const res = decideHello(h, d.state(who), d.releases?.() ?? []);
      ensure();
      // A purge leaves no ledger row: the device is about to wipe itself and its next hello starts fresh.
      if (res.ok.mode === "purge") d.db.run("DELETE FROM sync_hello WHERE person = ? AND device = ?", who.person, who.device);
      else d.db.run(
        "INSERT INTO sync_hello (person, device, app_version, registry_hash, mode, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(person, device) DO UPDATE SET app_version = excluded.app_version, registry_hash = excluded.registry_hash, mode = excluded.mode, at = excluded.at",
        who.person, who.device, h.appVersion, h.registryHash, res.ok.mode, d.now(),
      );
      return res;
    },
    canWrite,
    assertCanWrite,
    seen,
    forget(person, device) { ensure(); d.db.run("DELETE FROM sync_hello WHERE person = ? AND device = ?", person, device); },
    guardPushDeps(deps) {
      return {
        ...deps,
        invoke(call) {
          assertCanWrite(call.principal, call.deviceId, call.traceId);
          return deps.invoke(call);
        },
      };
    },
  };
}
