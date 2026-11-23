// backup.run with no target chosen writes to the host's backups folder (VYRE_BACKUP_DIR, mounted into the server), never to a folder inside the Space's own data.
import test from "node:test";
import assert from "node:assert/strict";
import { createBackupHost } from "./backup.ts";
import type { BackupHostDeps } from "./backup.ts";

const deps = (backupDir: string | undefined): BackupHostDeps =>
  ({
    root: "/data",
    space: "spc_x",
    log: {} as never,
    owner: () => null,
    system: async () => ({}),
    vault: {} as never,
    blobs: { put: async () => "blb_x" },
    fetch: (async () => ({})) as never,
    backupDir,
  }) as BackupHostDeps;

test("the default target is the mounted backups folder; none when it is unset, relative, or inside the Space folder", () => {
  assert.deepEqual(createBackupHost(deps("/backups")).defaultTarget, { kind: "local", path: "/backups" });
  assert.equal(createBackupHost(deps(undefined)).defaultTarget, undefined, "unset: no default, the old message stays");
  assert.equal(createBackupHost(deps("backups")).defaultTarget, undefined, "relative");
  assert.equal(createBackupHost(deps("/data")).defaultTarget, undefined, "the Space folder itself");
  assert.equal(
    createBackupHost(deps("/data/backups")).defaultTarget,
    undefined,
    "inside the Space folder: a backup would copy the earlier ones",
  );
});
