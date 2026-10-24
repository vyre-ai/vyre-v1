// Golden flow 10: Key failure fallback. Steps live in golden/steps/10-key-failure-fallback.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 10,
  name: "key-failure-fallback",
  title: "Key failure fallback",
  needs: ["identity", "devices", "tasks"],
  events: ["signin.failed", "recovery.saved", "signin.succeeded"],
});
