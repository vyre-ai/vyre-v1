// Golden flow 7: Gate approval and expiry. Steps live in golden/steps/07-gate-approval-expiry.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 7,
  name: "gate-approval-expiry",
  title: "Gate approval and expiry",
  needs: ["gate", "tasks", "mail"],
  events: ["gate.requested", "task.escalated", "gate.expired"],
});
