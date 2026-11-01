import test from "node:test";
import assert from "node:assert/strict";
import { catchUpLine } from "./catch-up.tsx";

const name = (id: string): string => ({ usr_maya: "Maya Chen", usr_noah: "Noah Reed" })[id] ?? id;
const base = { unread: 0, firstMessageId: null, people: [], tasks: [], decisions: [], at: [] };

test("the catch-up line says how many, from whom, what was decided or made a task, and how many name you; it is empty for one message", () => {
  assert.equal(catchUpLine({ ...base, unread: 1, people: [{ id: "usr_maya", count: 1 }] }, name, 0), "");
  assert.equal(catchUpLine({ ...base, unread: 3, people: [{ id: "usr_maya", count: 3 }] }, name, 0), "3 new from Maya.");
  const full = { ...base, unread: 9, people: [{ id: "usr_maya", count: 5 }, { id: "usr_noah", count: 4 }], tasks: [{ messageId: "m1", title: "x" }], decisions: [{ messageId: "m2", text: "y" }, { messageId: "m3", text: "z" }] };
  assert.equal(catchUpLine(full, name, 1), "9 new from Maya and 1 other. 2 decisions, 1 task. 1 message names you.");
});
