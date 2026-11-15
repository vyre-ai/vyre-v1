// The connect card in the real app, PERSONAL Space, desktop 1440 wide in both skins: every state pictured, the keyboard walk, every control does something, the agent goes on by itself, Disconnect then ask again. The walk itself lives in connect-walk-kit.ts; each file is one half so that no file runs longer than the runner's cap.
import test from "node:test";
import { DESKTOP, personalWalk } from "./connect-walk-kit.ts";

test("PERSONAL Space, desktop 1440 wide in both skins: every state pictured, the keyboard walk, every control does something, the agent goes on by itself, Disconnect then ask again", async (t) => {
  await personalWalk(t, DESKTOP, "desktop");
});
