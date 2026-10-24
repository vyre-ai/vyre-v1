// Capability handlers for audit (10). One file holds them all: log.ts.
import { append, archive, archivesList, chainHealth, checkpoint, checkpointsList, exportCsv, get, list, verify } from "./log.ts";

export type { AuditCtx } from "../projections.ts";

export const handlers = {
  "audit.append": append,
  "audit.archive": archive,
  "audit.archives.list": archivesList,
  "audit.chain_health": chainHealth,
  "audit.checkpoint": checkpoint,
  "audit.checkpoints.list": checkpointsList,
  "audit.export": exportCsv,
  "audit.get": get,
  "audit.list": list,
  "audit.verify": verify,
};
