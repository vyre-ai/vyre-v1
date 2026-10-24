// Golden flow 14: Sync revocation purge. Steps live in golden/steps/14-sync-revocation-purge.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 14,
  name: "sync-revocation-purge",
  title: "Sync revocation purge",
  needs: ["sync", "access", "search"],
  events: ["grant.revoked", "sync.scope_changed", "sync.epoch_bumped"],
});
