// The list vyre-server keeps of its own backups (host-backups.json) reaches backup.list: good rows are read, anything else in the file is ignored, a missing or broken file is empty.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOST_BACKUPS_FILE, readHostBackups } from "./backup.ts";

test("readHostBackups reads the rows vyre-server wrote and ignores the rest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-hb-"));
  try {
    assert.deepEqual(readHostBackups(dir), [], "no file");
    fs.writeFileSync(path.join(dir, HOST_BACKUPS_FILE), "{ not json");
    assert.deepEqual(readHostBackups(dir), [], "a broken file");
    fs.writeFileSync(
      path.join(dir, HOST_BACKUPS_FILE),
      JSON.stringify([
        { name: "vyre-manual-20261119T174015Z.tar.gz", at: 1795110015000, sizeBytes: 3649799021 },
        { name: "../etc/passwd", at: 1, sizeBytes: 1 },
        { name: "vyre-manual-x.tar.gz", at: "yesterday", sizeBytes: 1 },
        "text",
      ]),
    );
    assert.deepEqual(readHostBackups(dir), [
      { name: "vyre-manual-20261119T174015Z.tar.gz", at: 1795110015000, sizeBytes: 3649799021 },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
