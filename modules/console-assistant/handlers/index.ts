// Capability handlers for console-assistant (7): thread.ts holds the thread, toolset and explain reads; apply.ts holds the diff card verbs.
import { apply, propose, reject } from "./apply.ts";
import { assistantOpen, assistantTools, contextSet, explainAccess } from "./thread.ts";

export type { AssistCtx } from "../projections.ts";

export const handlers = {
  "console.assistant_context_set": contextSet,
  "console.assistant_open": assistantOpen,
  "console.assistant_tools": assistantTools,
  "console.diff_apply": apply,
  "console.diff_propose": propose,
  "console.diff_reject": reject,
  "console.explain_access": explainAccess,
};
