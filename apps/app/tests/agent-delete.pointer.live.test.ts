// @tsx
// F77 in the real app: delete an agent for good, by pointer. See agent-delete-kit.ts for the walk: an agent with a one-to-one chat, a channel message, a task and an Automation step is moved to Trash from its page,
// restored (it answers again), trashed again and deleted for good from the Trash with the one confirm sheet; the row says Deleting and is gone; the channel shows its old message with a quiet "deleted"; the
// one-to-one chat is gone from the sidebar; the Automation says to choose another agent; the task no longer names it. Pictures go to VYRE_AGENTDEL_SHOTS.
import test from "node:test";
import { agentDeleteWalk } from "./agent-delete-kit.ts";

test("delete an agent for good in the real app, by pointer", async (t) => {
  await agentDeleteWalk(t, [["pointer", "Desk", "p"]]);
});
