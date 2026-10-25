// The live socket of a Space (ARCH 5.9) bound to the sync module: hello answers from the registry hash and the person's epoch, `ev` batches come from the same filtered pull as sync.pull.
// The gateway accepts the WebSocket, authenticates the device session and calls `hub.accept(transport, who)`; after every log commit it calls `hub.commit()` so subscribers hear in the same tick.
import { createLiveHub } from "../../../sync/src/live/index.ts";
import type { LiveClock, LiveHub, LiveWho } from "../../../sync/src/live/index.ts";
import type { ServerState } from "../../../sync/src/protocol.ts";
import { deviceEpochOf, deviceRevoked, headSeq, pullChanges } from "../../../sync/src/server/pull/index.ts";
import type { PullDeps } from "../../../sync/src/server/pull/index.ts";

export interface LiveOpts {
  clock: LiveClock;
  /** The registry hash this server runs (5.2). */
  registryHash: string;
  serverVersion?: string;
  /** Hashes of older releases a client may still run live, and ones known to be older (update_required). */
  compatibleRegistryHashes?: readonly string[];
  olderRegistryHashes?: readonly string[];
  /** Entities whose schema moved in a way incremental DDL cannot bridge. */
  breakingEntities?: readonly string[];
  heartbeatMs?: number;
  deadMs?: number;
  window?: number;
  batch?: number;
}

/** Schema versions the replica may hold: every entity the server knows is at version 1 until a migration says otherwise. */
function entityVersions(d: PullDeps): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of d.catalog.known()) out[e.key] = 1;
  for (const r of d.db.all<{ entity: string }>("SELECT DISTINCT entity FROM sync_rows")) out[r.entity] = 1;
  return out;
}

export function createSyncLiveHub(deps: PullDeps, o: LiveOpts): LiveHub {
  const hub = createLiveHub({
    clock: o.clock,
    ...(o.heartbeatMs !== undefined ? { heartbeatMs: o.heartbeatMs } : {}),
    ...(o.deadMs !== undefined ? { deadMs: o.deadMs } : {}),
    ...(o.window !== undefined ? { window: o.window } : {}),
    ...(o.batch !== undefined ? { batch: o.batch } : {}),
    head: () => headSeq(deps.db),
    pull: (who: LiveWho, req) => pullChanges(deps, who, req),
    state: (who: LiveWho): ServerState => ({
      serverVersion: o.serverVersion ?? "1.0.0",
      epoch: deviceEpochOf(deps.db, who.person, who.device),
      head: headSeq(deps.db),
      serverHlc: deps.hlc(),
      registryHash: o.registryHash,
      compatibleRegistryHashes: o.compatibleRegistryHashes ?? [],
      olderRegistryHashes: o.olderRegistryHashes ?? [],
      entityVersions: entityVersions(deps),
      ...(o.breakingEntities ? { breakingEntities: o.breakingEntities } : {}),
    }),
  });
  // A revoked device learns nothing: no hello_ok (no head, no clock, no entity list). It is told to purge, then the socket closes as auth.device_revoked.
  return {
    ...hub,
    accept(t, who) {
      if (!deviceRevoked(deps.db, who.person, who.device)) return hub.accept(t, who);
      t.send({ t: "purge", epoch: deviceEpochOf(deps.db, who.person, who.device) });
      t.close("auth.device_revoked");
      return { who, mode: () => "purge", sent: () => 0, acked: () => 0, close: () => {} };
    },
  };
}
