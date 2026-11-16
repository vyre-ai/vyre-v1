// The connect card in the real app for the services a key is pasted for (r32-connect, 16 Nov 2026), part B. The walk itself lives in connect-services-walk-kit.ts; each file is one part so that no file runs longer than the runner's cap.
import test from "node:test";
import { DESKTOP, PHONE } from "./connect-walk-kit.ts";
import { servicesWalk } from "./connect-services-walk-kit.ts";

test("Mailgun, Dropbox Sign, Twilio: ask, wrong key, key without permission, unreachable, good key, the agent goes on by itself, Disconnect, ask again shows a clean card", async (t) => {
  await servicesWalk(t, ["Mailgun", "Dropbox Sign", "Twilio"], DESKTOP.slice(0, 1), "desktop-b");
});
