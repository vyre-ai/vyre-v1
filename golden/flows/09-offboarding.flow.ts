// Golden flow 9: Offboarding. Steps live in golden/steps/09-offboarding.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 9,
  name: "offboarding",
  title: "Offboarding",
  needs: ["members", "devices", "access", "tasks"],
  events: ["member.removal_plan_applied", "member.removed", "device.purged", "session.revoked"],
});
