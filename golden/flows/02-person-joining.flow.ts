// Golden flow 2: A person joining. Steps live in golden/steps/02-person-joining.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 2,
  name: "person-joining",
  title: "A person joining",
  needs: ["members", "identity", "devices", "home", "access"],
  events: ["member.invited", "member.joined", "keys.stored", "session.started"],
});
