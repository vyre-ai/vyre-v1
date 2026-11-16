// The connect card in the real app, TEAM Space, desktop 1440 wide in both skins: a member asks an admin, the admin connects, the member card finishes by itself, Disconnect. The walk itself lives in connect-walk-kit.ts; each file is one half so that no file runs longer than the runner's cap.
import test from "node:test";
import { teamWalk, DESKTOP } from "./connect-walk-kit.ts";

test("TEAM Space, desktop 1440 wide in both skins: a member asks an admin, the admin connects, the member card finishes by itself, Disconnect", async (t) => {
  await teamWalk(t, DESKTOP, "desktop");
});
