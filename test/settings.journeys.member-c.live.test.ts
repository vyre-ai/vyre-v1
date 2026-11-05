// The real app, Settings walked as a person (see test/support/settings-walk.ts): one file per person and part, so each stays inside the release-evidence watchdog. Part c: Notifications, Appearance and Privacy and security, with the saved channel and look.
import test from "node:test";
import { walkSettings } from "./support/settings-walk.ts";

test("settings journey: part c of the pages as Member, the look and a channel saved on the server", async (t) => { await walkSettings(t, "member", "c"); });
