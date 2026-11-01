// The unblock task a turn with no AI account leaves (modules/engine/runtime.ts NO_ACCOUNT_TITLE). Its one action is the direct sign-in, not an agent computer.
import { mailFixOf } from "../../../shell/connect/model.ts";
import type { Task } from "./model.ts";

export const NO_ACCOUNT_TITLE = "Connect an AI account";

export const isNoAccount = (t: Pick<Task, "kind" | "title">): boolean => t.kind === "unblock" && t.title === NO_ACCOUNT_TITLE;

/** The unblock task a lost mailbox sign-in leaves: its one action opens Connect a mailbox on the right tab instead of acting on the task. */
export const mailFix = mailFixOf;
