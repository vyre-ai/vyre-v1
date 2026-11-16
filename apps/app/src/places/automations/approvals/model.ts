// What an Automation that waits for a person's approval shows (rc.32 lane r32-auto, item 6): a card on the first page and in the run with Allow and Deny (the one approval vocabulary, test/approval-words.test.ts) and a line for what
// happens on each. Pure: the screens read the task, the step and the steps' sentences and hand them here. The engine decides (modules/steps-core/handlers/control.ts approvalStep); this only says what it will do.
import { movesFor } from "../../chats/tasks/moves.ts";
import type { MoveTask } from "../../chats/tasks/moves.ts";

export interface ApprovalTask extends MoveTask {
  id: string;
  title: string;
  summary?: string | undefined;
}
export interface ApprovalNode {
  id: string;
  next?: readonly string[] | undefined;
  branches?: readonly { label: string; to: string }[] | undefined;
}
export interface ApprovalCard {
  taskId: string;
  title: string;
  summary?: string;
  /** What happens when the person presses Allow, and Deny. */
  allow: string;
  deny: string;
}

const YES = /^(approved|allow|allowed|yes)$/i;
const NO = /^(rejected|deny|denied|no)$/i;

/** The card for a person, or null when the task is not waiting on them (someone else's turn, or already decided). */
export function approvalCard(i: {
  task: ApprovalTask;
  me: string;
  node: ApprovalNode;
  say(stepId: string): string | undefined;
}): ApprovalCard | null {
  const moves = movesFor(i.task, i.me);
  if (!moves.some((m) => m.key === "approve") || !moves.some((m) => m.key === "reject")) return null;
  const named = (id: string | undefined): string | undefined => (id === undefined ? undefined : i.say(id));
  const branch = (re: RegExp): string | undefined => i.node.branches?.find((b) => re.test(b.label.trim()))?.to;
  const onward = named(branch(YES) ?? i.node.next?.[0]);
  const noPath = named(branch(NO));
  const afterNo = named(i.node.next?.[0]);
  return {
    taskId: i.task.id,
    title: i.task.title,
    ...(i.task.summary ? { summary: i.task.summary } : {}),
    allow: onward ? `It goes on: ${onward}.` : "It finishes.",
    deny: noPath
      ? `It goes to: ${noPath}.`
      : afterNo
        ? `It goes on with your no: ${afterNo}.`
        : "It finishes with your no.",
  };
}

/** The one capability call an answer makes: tasks.act on the approval, a no with its reason (the task asks for the note). */
export function answerFor(
  taskId: string,
  answer: "allow" | "deny",
  reason = "",
): {
  cap: "tasks.act";
  input: { taskId: string; action: "approve" } | { taskId: string; action: "reject"; note: string };
} {
  if (answer === "allow") return { cap: "tasks.act", input: { taskId, action: "approve" } };
  if (reason.trim() === "") throw new Error("Say why, so the person who started it can read it.");
  return { cap: "tasks.act", input: { taskId, action: "reject", note: reason.trim() } };
}
