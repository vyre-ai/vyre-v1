// The real app, Settings walked as a person (see test/support/settings-walk.ts): one file per person so each stays inside the release-evidence watchdog.
import test from "node:test";
import { walkSettings } from "./support/settings-walk.ts";

test("settings journey: the seven pages as Member, the look and a channel saved on the server", async (t) => { await walkSettings(t, "member"); });
