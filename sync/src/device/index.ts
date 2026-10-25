// Device storage encryption (ARCH 5.10) and replica profiles in practice (ARCH 5.11).
export { deviceClassOf, RECORDED_OUTCOME, selectEngine } from "./engines.ts";
export type { DeviceTarget, EngineChoice, EngineId, ProbeResult, SpikeOutcome } from "./engines.ts";
export { REPLICA_KEY_BYTES, createReplicaKeyVault, deriveReplicaKey, indexedDbKeyBox, memoryKeyBox } from "./keys.ts";
export type { KeyBox, ReplicaKeyVault } from "./keys.ts";
export { createSyncDriver } from "./driver.ts";
export type { SyncEngine } from "./driver.ts";
export { openSqlCipher, rekeySqlCipher, unlockSqlCipher } from "./sqlcipher.ts";
export { openCipherOpfs, rekeyCipherOpfs } from "./sqlite3mc.ts";
export type { McDatabase, McModule, McStatement } from "./sqlite3mc.ts";
export { createSealCodec } from "./sealed.ts";
export type { SealCodec } from "./sealed.ts";
export { openDeviceReplica, slotOf } from "./open.ts";
export type { DeviceReplica, EngineOpeners, OpenDeviceReplica } from "./open.ts";
