// The connect card in the real app, TEAM Space, phone 390 wide in both skins: a member asks an admin, the admin connects, the member card finishes by itself. The walk itself lives in connect-walk-kit.ts; each file is one half so that no file runs longer than the runner's cap.
import test from "node:test";
import { teamWalk, PHONE } from "./connect-walk-kit.ts";

test("TEAM Space, phone 390 wide in both skins: a member asks an admin, the admin connects, the member card finishes by itself", async (t) => {
  await teamWalk(t, PHONE, "phone");
});
