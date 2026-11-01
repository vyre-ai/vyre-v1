// The unblock task a turn with no AI account leaves (modules/engine/runtime.ts NO_ACCOUNT_TITLE). Its one action is the direct sign-in, not an agent computer.
import type { Task } from "./model.ts";

export const NO_ACCOUNT_TITLE = "Connect an AI account";

export const isNoAccount = (t: Pick<Task, "kind" | "title">): boolean => t.kind === "unblock" && t.title === NO_ACCOUNT_TITLE;

/** The unblock task a lost mailbox sign-in leaves (modules/google and microsoft handlers/personal.ts): its one action opens Connect a mailbox on the right tab instead of acting on the task. */
export function mailFix(t: Pick<Task, "kind" | "blocks">): "google" | "microsoft" | null {
  if (t.kind !== "unblock") return null;
  const b = t.blocks.find((x) => x.type === "mail_signin");
  const d = b?.data;
  const provider = typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>)["provider"] : undefined;
  return provider === "google" || provider === "microsoft" ? provider : null;
}
