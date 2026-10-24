// All 15 flow definitions, imported statically so the import graph (ci-select, pass cache) sees each file.
import type { Flow } from "../harness/index.ts";
import f1 from "./01-lead-to-client-to-project.flow.ts";
import f2 from "./02-person-joining.flow.ts";
import f3 from "./03-agent-changes-reviewed.flow.ts";
import f4 from "./04-offline-edit-conflict.flow.ts";
import f5 from "./05-lead-campaign-reply-call.flow.ts";
import f6 from "./06-site-deploy-rollback.flow.ts";
import f7 from "./07-gate-approval-expiry.flow.ts";
import f8 from "./08-memory-promotion.flow.ts";
import f9 from "./09-offboarding.flow.ts";
import f10 from "./10-key-failure-fallback.flow.ts";
import f11 from "./11-backup-restore-tombstones.flow.ts";
import f12 from "./12-permission-matrix.flow.ts";
import f13 from "./13-private-chat-e2e.flow.ts";
import f14 from "./14-sync-revocation-purge.flow.ts";
import f15 from "./15-personal-space-relay.flow.ts";
export const FLOWS: Flow[] = [f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15];
