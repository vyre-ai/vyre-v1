// P-L7b_18: golden flow 11 finds backup.list empty right after backup.run. This boots the flow's own Space (backup, governance, files ... live in a temporary code root) and does what the flow does, through
// the gateway: set a local target, run a backup, list. When the list is empty the message carries the stored attempt (state and reason), because backup.run answers a backup id even when the copy failed
// (it emits backup.failed and keeps the attempt, spec 2.26), so an empty list needs the reason to be read.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootFlowSpace } from "../golden/steps/02-space.ts";
import { LIVE_FOR_RESTORE } from "../golden/steps/11-backup-restore-tombstones.ts";

test("backup.list shows the backup right after backup.run, with governance live", async () => {
  const s = await bootFlowSpace(LIVE_FOR_RESTORE);
  try {
    const admin = s.d.token;
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-backup-list-"));
    const set = await s.call("backup.config_set", admin, { target: { kind: "local", path: target }, schedule: "0 3 * * *", enabled: true });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const run = await s.call("backup.run", admin, {});
    assert.equal(run.status, 200, JSON.stringify(run.body));
    const list = await s.call("backup.list", admin, {});
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const attempts = s.d.db.all("SELECT backup_id, state, reason FROM backup_item");
    assert.ok(list.body.data.backups.some((b) => b.backupId === run.body.data.backupId), `the backup is listed; stored attempts: ${JSON.stringify(attempts)}`);
  } finally { await s.stop(); }
});
