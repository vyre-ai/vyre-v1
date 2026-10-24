// Golden flow 5: Lead to campaign to reply to call. Steps live in golden/steps/05-lead-campaign-reply-call.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 5,
  name: "lead-campaign-reply-call",
  title: "Lead to campaign to reply to call",
  needs: ["campaigns", "gate", "mail", "telephony", "contacts-link"],
  events: ["gate.requested", "campaign.launched", "campaign.replied", "call.started"],
});
