// Golden flow 5: Lead to Automation email to reply to call. Steps live in golden/steps/05-lead-automation-reply-call.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 5,
  name: "lead-automation-reply-call",
  title: "Lead to Automation email to reply to call",
  needs: ["automations", "gate", "mail", "telephony", "contacts-link"],
  events: ["automation.run_started", "message.sent", "gate.approved", "mail.received", "message.suppressed", "call.started"],
});
