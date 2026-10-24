// Golden flow 11: Backup restore with tombstones. Steps live in golden/steps/11-backup-restore-tombstones.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 11,
  name: "backup-restore-tombstones",
  title: "Backup restore with tombstones",
  needs: ["backup", "governance", "records"],
  events: ["backup.completed", "erase.completed", "backup.restored", "tombstones.reapplied"],
});
