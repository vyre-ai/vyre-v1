// A first pull cut off in its second group (an app error) carries on by itself (the cases are in test/support/sync-retry-case.ts).
import { retryCase } from "./support/sync-retry-case.ts";

retryCase("500");
