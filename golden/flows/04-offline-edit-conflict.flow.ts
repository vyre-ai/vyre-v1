// Golden flow 4: Offline edit and conflict. Steps live in golden/steps/04-offline-edit-conflict.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 4,
  name: "offline-edit-conflict",
  title: "Offline edit and conflict",
  needs: ["sync", "conflicts", "records"],
  events: ["conflict.opened", "conflict.resolved", "record.updated", "conflict.undone"],
});
