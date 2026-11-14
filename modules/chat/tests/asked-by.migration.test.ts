// chat_message.askedBy (whose turn a reply was written for) is a numbered migration of the chat module: the host's run adds the column once, in order after the earlier files, and a snapshot of modules.db carries it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../../../host/src/daemon/hosttables.ts";
import { openDb } from "../../../host/src/daemon/sqlite.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("the host's migration run adds chat_message.askedBy from its numbered file, after the earlier chat files, once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-askedby-"));
  const db = openDb(path.join(dir, "modules.db"));
  const ran = migrate(db, ROOT, () => 1)
    .filter((r) => r.module === "chat")
    .map((r) => r.file);
  assert.ok(ran.includes("0011_asked_by.sql"), "the numbered file ran");
  assert.deepEqual(ran, [...ran].sort(), "in order");
  assert.ok(ran.indexOf("0011_asked_by.sql") > ran.indexOf("0008_mentions.sql"));
  assert.deepEqual(
    migrate(db, ROOT, () => 2).filter((r) => r.module === "chat"),
    [],
    "and does not run twice",
  );
  const cols = (db.all("PRAGMA table_info(chat_message)") as Array<{ name: string }>).map((c) => c.name);
  assert.ok(cols.includes("askedBy"));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
