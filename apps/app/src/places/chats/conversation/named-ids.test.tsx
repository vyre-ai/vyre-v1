// A principal id that slips into a reply reads as the name it stands for.
import test from "node:test";
import assert from "node:assert/strict";
import { namedIds } from "./MessageView.tsx";

test("a known person's id in a reply shows as their name; an unknown one and plain text stay", () => {
  const nameOf = (id: string): string => (id === "usr_2191954f8e634c40c6" ? "Aliza Rizvi" : id);
  assert.equal(namedIds("I wrote to usr_2191954f8e634c40c6 about it", nameOf), "I wrote to Aliza Rizvi about it");
  assert.equal(namedIds("I wrote to usr_aaaaaaaaaaaaaaaaaa", nameOf), "I wrote to usr_aaaaaaaaaaaaaaaaaa");
  assert.equal(namedIds("nothing here", nameOf), "nothing here");
  assert.equal(namedIds("usr_2191954f8e634c40c6", undefined), "usr_2191954f8e634c40c6");
});

import { statusView, stoppedWords } from "./status.ts";
test("a stopped turn always says why", () => {
  for (const r of ["interrupt", "stop", "limit", "left", "moved", "lease", ""])
    assert.notEqual(stoppedWords(r), "Stopped.", `reason "${r}"`);
  assert.match(stoppedWords("interrupt"), /new message/);
  assert.match(stoppedWords(""), /no reason was recorded/);
});

test("who stopped a turn: your own stop reads 'You stopped this.', another person's names them, a system stop and a turn with no record keep today's words (G: Stopped by)", () => {
  const who = { meId: "usr_me", nameOf: (id: string) => (id === "usr_maya" ? "Maya Chen" : id) };
  assert.match(
    stoppedWords("stop", { id: "usr_me", kind: "person" }, who),
    /^You stopped this\. The steps so far are kept\.$/,
  );
  assert.match(
    stoppedWords("stop", { id: "usr_maya", kind: "person" }, who),
    /^Stopped by Maya Chen\. The steps so far are kept\.$/,
  );
  assert.match(
    stoppedWords("stop", { id: "agt_dex", kind: "agent" }, { ...who, nameOf: () => "Dex" }),
    /^Stopped by Dex\./,
  );
  // a person who sent a new message while it worked: named only when it is someone else
  assert.match(stoppedWords("interrupt", { id: "usr_maya", kind: "person" }, who), /Maya Chen sent a new message/);
  assert.equal(stoppedWords("interrupt", { id: "usr_me", kind: "person" }, who), stoppedWords("interrupt"));
  // the system, and nothing recorded (an old turn, a stop a restart closed): the words of today
  assert.equal(stoppedWords("lease", { id: "system", kind: "system" }, who), stoppedWords("lease"));
  assert.equal(stoppedWords("stop", { id: "system", kind: "system" }, who), stoppedWords("stop"));
  assert.equal(stoppedWords("stop", undefined, who), "Stopped. The steps so far are kept.");
  assert.equal(stoppedWords("stop"), "Stopped. The steps so far are kept.");
});

test("the status line of a cancelled turn reads the block's stoppedBy, and an old block without it still reads", () => {
  const block = (data: Record<string, unknown>) =>
    ({
      type: "turn_status",
      v: 1,
      id: "b",
      data: { state: "cancelled", reason: "stop", ...data },
      traceId: "t",
    }) as never;
  const o = { meId: "usr_me", nameOf: (id: string) => (id === "usr_maya" ? "Maya Chen" : id) };
  const text = (v: ReturnType<typeof statusView>): string => ("text" in v ? v.text : "");
  assert.equal(
    text(statusView(block({ stoppedBy: { id: "usr_maya", kind: "person" } }), o)),
    "Stopped by Maya Chen. The steps so far are kept.",
  );
  assert.equal(
    text(statusView(block({ stoppedBy: { id: "usr_me", kind: "person" } }), o)),
    "You stopped this. The steps so far are kept.",
  );
  assert.equal(text(statusView(block({}), o)), "Stopped. The steps so far are kept.");
  assert.equal(text(statusView(block({ stoppedBy: "garbage" }), o)), "Stopped. The steps so far are kept.");
});
