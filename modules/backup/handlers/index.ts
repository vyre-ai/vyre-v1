// Capability handlers for backup (spec 5 Backups and export, 2.26; ARCH 7.10). Config, run, list, delete, health and the owner export are in run.ts;
// preview, restore and verify are in restore.ts. Every capability needs server.backups (the pipeline checks it); restore is held by the Gate (delete act).

import { config_get, config_set, del, export_start, health, list, run } from "./run.ts";
import { restore, restore_preview, verify } from "./restore.ts";

export type { BackupCtx, BackupDrivers, BackupTarget, SpaceSnapshot, SpaceSource, Tombstone } from "./run.ts";
export { configureBackup } from "./run.ts";

export const handlers = {
  "backup.config_get": config_get,
  "backup.config_set": config_set,
  "backup.list": list,
  "backup.run": run,
  "backup.restore_preview": restore_preview,
  "backup.restore": restore,
  "backup.verify": verify,
  "backup.delete": del,
  "backup.export_start": export_start,
  "backup.health": health,
};
