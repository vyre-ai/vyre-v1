// Golden flow 6: Site deploy and rollback. Steps live in golden/steps/06-site-deploy-rollback.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 6,
  name: "site-deploy-rollback",
  title: "Site deploy and rollback",
  needs: ["sites", "gate"],
  events: ["site.preview_created", "gate.requested", "site.promoted", "site.rolled_back"],
});
