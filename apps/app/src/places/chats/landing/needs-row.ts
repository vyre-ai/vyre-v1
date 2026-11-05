// One row of the Needs you list under the composer on the Chats landing: what the task is, its action and whether it acts in place.
import type { CapMap } from "../../../../../../generated/types.ts";

export type NeedsItem = CapMap["tasks.needs_you"]["out"]["items"][number];

export const KIND_LABEL: Record<NeedsItem["task"]["kind"], string> = {
  approve: "Approve", review: "Review", answer: "Answer", unblock: "Blocked", signature: "Sign", work: "Work",
};

export interface NeedsRow {
  id: string;
  title: string;
  kind: string;
  /** warn for a task that is stuck (Unblock), accent otherwise */
  tone: "accent" | "warn";
  sub: string;
  actionKey: string;
  actionLabel: string;
  /** Approve acts in place; Review, Answer, Unblock and Sign open the item in Needs you, where the thing to look at is. */
  inline: boolean;
  requester: string;
  reason: NeedsItem["reason"];
}

export function needsRow(item: NeedsItem, nameOf: (id: string) => string): NeedsRow {
  const t = item.task;
  const first = t.actions[0];
  const kind = KIND_LABEL[t.kind];
  const handled = item.handledBy ? ` · Handled by ${nameOf(item.handledBy)}` : "";
  const sub = t.summary ?? "";
  return {
    id: t.id, title: t.title, kind, tone: t.kind === "unblock" || t.blocked ? "warn" : "accent",
    sub: `${sub}${handled}`,
    actionKey: first?.key ?? "open", actionLabel: first?.label ?? (t.kind === "unblock" ? "Unblock" : kind),
    inline: t.kind === "approve" && first !== undefined && first.note !== "required",
    requester: t.createdBy, reason: item.reason,
  };
}
