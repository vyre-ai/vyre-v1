import test from "node:test";
import assert from "node:assert/strict";
import { activityRows, activityTitle, namedResource, repeatedTitle } from "./format.ts";

test("admin activity names what an act was on, and leaves out what it has no name for", () => {
  const name = (id: string): string => (id === "rec_1" ? "Acme Legal" : "Someone");
  assert.equal(
    activityTitle("Tom Reyes", "schema.apply", namedResource("spc_fresh", name)),
    "Tom Reyes applied the data model",
  );
  assert.equal(
    activityTitle("Tom Reyes", "records.update", namedResource("rec_1", name)),
    "Tom Reyes updated the record Acme Legal",
  );
});

test("the same act by the same person in a row is one line with a count (owner, 13 Nov 2026: Dex posted a chat, four times)", () => {
  const name = (id: string): string => ({ agt_dex: "Dex", usr_tom: "Tom Reyes" })[id] ?? "Someone";
  const chat = (at: number) => ({ at, actor: "agt_dex", action: "chat.post" });
  const rows = activityRows([chat(900), chat(890), chat(880), chat(870), { at: 860, actor: "usr_tom", action: "records.update", resource: "rec_1" }, { at: 850, actor: "usr_tom", action: "records.update", resource: "rec_1" }, chat(840)], (id) => (id === "rec_1" ? "Acme Legal" : name(id)));
  assert.deepEqual(rows.map((r) => [r.title, r.count, r.at]), [["Dex posted 4 chats", 4, 900], ["Tom Reyes updated the record Acme Legal, 2 times", 2, 860], ["Dex posted a chat", 1, 840]]);
  assert.equal(activityRows([{ at: 2, actor: "agt_dex", action: "chat.post" }, { at: 1, actor: "usr_tom", action: "chat.post" }], name).length, 2, "two people are two lines");
});

test("a repeated line says its count in words", () => {
  assert.equal(repeatedTitle("Dex posted a chat", 1), "Dex posted a chat");
  assert.equal(repeatedTitle("Dex posted a chat", 3), "Dex posted 3 chats");
  assert.equal(repeatedTitle("Tom Reyes deleted a Vault item", 2), "Tom Reyes deleted 2 Vault items");
  assert.equal(repeatedTitle("Dex created a directory", 2), "Dex created 2 directories");
  assert.equal(repeatedTitle("Dex sent an email to Maya", 2), "Dex sent an email to Maya, 2 times");
});
