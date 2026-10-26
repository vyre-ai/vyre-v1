// backup: handlers, projections and codecs. The host loads this file once the manifest says status live.
// The host calls configureBackup once at boot with the Space's data source, the export sink and the S3 transport (ruling 32: through hostSeams.setBackupHost).
import { configureBackup, handlers } from "./handlers/index.ts";
import type { BackupDrivers } from "./handlers/index.ts";

export { handlers, configureBackup };
export { consumers, inline, projections } from "./projections.ts";
export const codecs = {};

/** The loader collects this (ruling 31). The daemon calls setBackupHost with host/src/seams/backup.ts and with null at shutdown. */
export const hostSeams = { setBackupHost: (host: BackupDrivers | null): void => configureBackup(host) };
