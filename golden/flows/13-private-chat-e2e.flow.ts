// Golden flow 13: Private chat E2E. Steps live in golden/steps/13-private-chat-e2e.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 13,
  name: "private-chat-e2e",
  title: "Private chat E2E",
  needs: ["chat", "identity", "vault"],
  events: ["thread.started", "message.received"],
});
