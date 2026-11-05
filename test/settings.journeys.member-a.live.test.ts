// The real app, Settings walked as a person (see test/support/settings-walk.ts): one file per person and part, so each stays inside the release-evidence watchdog. Part a: Profile, Your AI and This device.
import test from "node:test";
import { walkSettings } from "./support/settings-walk.ts";

test("settings journey: part a of the pages as Member, the look and a channel saved on the server", async (t) => { await walkSettings(t, "member", "a"); });
