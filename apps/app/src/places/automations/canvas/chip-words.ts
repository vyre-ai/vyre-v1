// The words on a step card's status chip. The model keeps one flag for every kind of trouble ("error"); a person reads what is wrong in one to three words ("Needs a file"), never the flag itself.
import { chipForIssue } from "../../../../../../lib/words/step-missing.ts";
import type { Issue, RunState, StatusChip } from "./model.ts";

export function chipText(chip: StatusChip, issues: readonly Issue[], state: RunState | undefined): string {
  if (chip !== "error") return chip;
  const first = issues.find((i) => i.severity === "error");
  if (first) return chipForIssue(first.message);
  return state === "failed" ? "Failed" : "Needs a fix";
}
