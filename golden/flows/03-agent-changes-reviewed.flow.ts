// Golden flow 3: Agent changes reviewed and pushed. Steps live in golden/steps/03-agent-changes-reviewed.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 3,
  name: "agent-changes-reviewed",
  title: "Agent changes reviewed and pushed",
  needs: ["agents", "git", "gate"],
  events: ["git.committed", "git.pushed", "gate.approved"],
});
