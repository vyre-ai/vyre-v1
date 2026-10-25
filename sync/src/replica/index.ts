// Public replica store. Device engines share ReplicaStore; only the driver changes.
export { loadCatalog } from "./catalog.ts";
export { loadReplicaSql, resolveEntities, resolveReplicaSql } from "./ddl.ts";
export { createExpoDriver } from "./expo.ts";
export type { ExpoDatabase, ExpoRunResult, ExpoStatement } from "./expo.ts";
export { createNodeDriver } from "./node.ts";
export { admit, ceilingRank, fieldsAboveCeiling, labelRankOf } from "./profile.ts";
export { openReplica } from "./store.ts";
export { BLOB_BUDGET_BYTES, DEVICE_LABEL_CEILING, LABEL_RANK, RESTRICTED_RANK, ReplicaError } from "./types.ts";
export type {
  DeviceClass, EntityInfo, LabelName, OpenReplicaOptions, ReplicaReason, ReplicaStore, ReplicaWrite, ReplicaWriteResult, SqlDriver, SqlRow, SqlValue,
} from "./types.ts";
export { bindWaSqlite, createWaDriver, openWaReplica } from "./wa.ts";
export type { WaDatabase, WaSqlite3, WaStatement } from "./wa.ts";
