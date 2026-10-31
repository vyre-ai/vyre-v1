// The unblock task a turn with no AI account leaves (modules/engine/runtime.ts NO_ACCOUNT_TITLE). Its one action is the direct sign-in, not an agent computer.
import type { Task } from "./model.ts";

export const NO_ACCOUNT_TITLE = "Connect an AI account";

export const isNoAccount = (t: Pick<Task, "kind" | "title">): boolean => t.kind === "unblock" && t.title === NO_ACCOUNT_TITLE;
