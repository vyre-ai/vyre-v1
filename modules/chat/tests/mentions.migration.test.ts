// chat_mention is a numbered migration of the chat module, so a Space upgrade creates it (the host runs every modules/<id>/migrations/*.sql once, in order) and a backup carries it (a snapshot is a
// VACUUM INTO copy of modules.db, which holds every module's tables, and a restore puts that copy back).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../../../host/src/daemon/hosttables.ts";
import { openDb } from "../../../host/src/daemon/sqlite.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("the host's migration run creates chat_mention from the module's numbered file, once, and a snapshot copy of modules.db carries it with its rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mention-"));
  const db = openDb(path.join(dir, "modules.db"));
  const ran = migrate(db, ROOT, () => 1);
  assert.ok(ran.some((r) => r.module === "chat" && r.file === "0008_mentions.sql"), "the numbered file ran");
  assert.deepEqual(migrate(db, ROOT, () => 2).filter((r) => r.module === "chat"), [], "and does not run twice");
  assert.deepEqual((db.all("PRAGMA table_info(chat_mention)") as Array<{ name: string }>).map((c) => c.name), ["message", "thread", "person", "at"]);
  db.run("INSERT INTO chat_mention (message, thread, person, at) VALUES (?, ?, ?, ?)", "msg_1", "thr_1", "usr_maya", 5);
  const copy = path.join(dir, "snapshot.db");
  db.exec(`VACUUM INTO '${copy}'`);   // how the backup seam copies modules.db (host/src/seams/backup.ts)
  const back = openDb(copy);
  assert.deepEqual((back.all("SELECT message, person FROM chat_mention") as Array<{ message: string; person: string }>).map((r) => [r.message, r.person]), [["msg_1", "usr_maya"]]);
  back.close(); db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
