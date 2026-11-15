// The connect card in the real app, PERSONAL Space, phone 390 wide in both skins: every state pictured, every control does something, the agent goes on by itself. The walk itself lives in connect-walk-harness.test.ts; each file is one half so that no file runs longer than the runner's cap.
import test from "node:test";
import { personalWalk, PHONE } from "./connect-walk-harness.test.ts";

test("PERSONAL Space, phone 390 wide in both skins: every state pictured, every control does something, the agent goes on by itself", async (t) => {
  await personalWalk(t, PHONE, "phone");
});
