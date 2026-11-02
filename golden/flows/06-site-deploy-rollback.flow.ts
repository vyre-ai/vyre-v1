// Golden flow 6: Site deploy and rollback. Steps live in golden/steps/06-site-deploy-rollback.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 6,
  name: "site-deploy-rollback",
  title: "A site is a route: publish, serve, stop; an artifact stays private",
  needs: ["sites", "gate"],
  events: ["site.created", "site.published", "site.stopped"],
});
