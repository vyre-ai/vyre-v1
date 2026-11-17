// A big Space reached through the relay the way a browser on vyre.run reaches it (17 Nov 2026: a firm's onboarding call, a Space of about 9,400 matters
// of 100 fields, 28,000 contacts, the relay's 1 MiB limit). What must hold anywhere: neither stream ends or comes near the limit, a web page is live at
// once and sent no history, the desktop gets the whole feed, the server's consumers catch up, and what a person does first answers. The same run with
// its speed budgets is test/bigspace.perf.test.ts (ruling 46: a speed number counts only on the v1-perf runners). BIG_FULL=1 runs the firm's own size.
import test from "node:test";
import { bigSpaceScenario } from "./support/bigspace-scenario.ts";

test(
  "a big Space opens live through the relay on a web page and on a desktop, nothing drops, and everything a person does first works",
  { timeout: 600_000 },
  () => bigSpaceScenario(false),
);
