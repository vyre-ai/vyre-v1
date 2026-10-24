// Golden flow 12: Permission matrix. Steps live in golden/steps/12-permission-matrix.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 12,
  name: "permission-matrix",
  title: "Permission matrix",
  needs: ["access", "members", "files"],
  events: ["view_as.started", "folder.shared", "item.moved", "grant.revoked", "access.requested", "access.granted"],
});
