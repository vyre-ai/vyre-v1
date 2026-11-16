// A first pull cut off in its second group (a dropped connection) carries on by itself (the cases are in test/support/sync-retry-case.ts).
import { retryCase } from "./support/sync-retry-case.ts";

retryCase("drop");
