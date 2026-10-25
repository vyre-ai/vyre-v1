// Open this device's replica: pick the engine (engines.ts), get the replica key (derive on first use, then only from the wrapped copy), unlock the engine, hand the driver to the one ReplicaStore.
import { openReplica } from "../replica/store.ts";
import { ReplicaError } from "../replica/types.ts";
import type { LabelName, ReplicaStore, SqlDriver } from "../replica/types.ts";
import { RECORDED_OUTCOME, deviceClassOf, selectEngine } from "./engines.ts";
import type { DeviceTarget, EngineChoice, SpikeOutcome } from "./engines.ts";
import { deriveReplicaKey } from "./keys.ts";
import type { ReplicaKeyVault } from "./keys.ts";
import { openCipherOpfs } from "./sqlite3mc.ts";
import type { McModule } from "./sqlite3mc.ts";
import { openSqlCipher } from "./sqlcipher.ts";
import type { ExpoDatabase } from "../replica/expo.ts";

/** What the app (which may import the engines) hands in. Only the engine the target uses needs to be present. */
export interface EngineOpeners {
  sqlcipher?: { open(file: string): ExpoDatabase };
  sqlite3mc?: { mod: McModule; vfs: string };
}

export interface OpenDeviceReplica {
  target: DeviceTarget;
  spaceId: string;
  deviceId: string;
  /** Database file name. Default `replica-<spaceId>.db`. */
  file?: string;
  vault: ReplicaKeyVault;
  /** Needed only when the vault holds no key for this Space and device yet (first sign-in). Never stored. */
  personKey?: Uint8Array;
  openers: EngineOpeners;
  registryHash: string;
  phoneCeiling?: LabelName;
  personId?: string;
  outcome?: SpikeOutcome;
  clock?: () => number;
}

export interface DeviceReplica {
  store: ReplicaStore;
  driver: SqlDriver;
  choice: EngineChoice;
  /** Milliseconds from call to a usable store: key load, engine unlock, schema, prepared statements. */
  openMs: number;
  /** True when this call derived and wrapped the key (first sign-in on this device). */
  keyCreated: boolean;
}

export const slotOf = (spaceId: string, deviceId: string): string => `${spaceId}:${deviceId}`;

export async function openDeviceReplica(o: OpenDeviceReplica): Promise<DeviceReplica> {
  const t0 = performance.now();
  const choice = selectEngine(o.target, o.outcome ?? RECORDED_OUTCOME);
  const slot = slotOf(o.spaceId, o.deviceId);
  let key = await o.vault.load(slot);
  let keyCreated = false;
  if (!key) {
    if (!o.personKey) throw new ReplicaError("no_key", "this device has no replica key yet; sign in to make one");
    key = await deriveReplicaKey(o.personKey, o.spaceId, o.deviceId);
    await o.vault.store(slot, key);
    keyCreated = true;
  }
  const file = o.file ?? `replica-${o.spaceId}.db`;
  let driver: SqlDriver;
  try {
    if (choice.engine === "sqlcipher-expo") {
      if (!o.openers.sqlcipher) throw new ReplicaError("engine_missing", "the SQLCipher opener is not wired on this device");
      driver = openSqlCipher({ open: o.openers.sqlcipher.open, file, key });
    } else if (choice.engine === "sqlite3mc-opfs") {
      if (!o.openers.sqlite3mc) throw new ReplicaError("engine_missing", "the sqlite3mc module is not loaded");
      driver = openCipherOpfs({ ...o.openers.sqlite3mc, file, key });
    } else {
      throw new ReplicaError("engine_missing", `${choice.engine} is the recorded fallback (${choice.reason}) and is not wired on this device`);
    }
  } finally {
    key.fill(0);
  }
  const store = openReplica({
    driver,
    deviceClass: deviceClassOf(o.target),
    registryHash: o.registryHash,
    ...(o.phoneCeiling ? { phoneCeiling: o.phoneCeiling } : {}),
    ...(o.personId ? { personId: o.personId } : {}),
    ...(o.clock ? { clock: o.clock } : {}),
  });
  return { store, driver, choice, openMs: performance.now() - t0, keyCreated };
}
