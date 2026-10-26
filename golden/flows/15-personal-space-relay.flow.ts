// Golden flow 15: Personal Space via the relay. Steps live in golden/steps/15-personal-space-relay.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 15,
  name: "personal-space-relay",
  title: "Personal Space via the relay",
  needs: ["spaces", "sync", "devices", "network"],
  events: ["device.registered", "session.started", "doc.updated", "device.revoked"],
});
