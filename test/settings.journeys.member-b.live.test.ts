// The real app, Settings walked as a person (see test/support/settings-walk.ts): one file per person and part, so each stays inside the release-evidence watchdog. Part b: GitHub.
import test from "node:test";
import { walkSettings } from "./support/settings-walk.ts";

test("settings journey: part b of the pages as Member, the look and a channel saved on the server", async (t) => { await walkSettings(t, "member", "b"); });
