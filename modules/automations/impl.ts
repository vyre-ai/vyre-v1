// Automations module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// `consumeEvent` is the trigger consumer the host runs for every event; `loadRunPlan` is what the executor reads for a Run of an Automation.
import { handlers } from "./handlers/index.ts";

export { handlers };
export { accessDiff, canView, structuralIssues, validateDefinition, webhookSecretMatches } from "./handlers/defs.ts";
export { consumeEvent, dropReason, fireOne, loadRunPlan, matches, startRun, triggerPayload } from "./handlers/triggers.ts";
