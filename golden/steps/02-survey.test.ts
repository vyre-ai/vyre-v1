// THROWAWAY survey (removed before submit): what does a boot with the L7 modules live say?
import test from "node:test";
import { bootFlowSpace } from "./02-space.ts";

test("survey: boot with the access-group modules live", async () => {
  for (const set of [["identity", "members", "devices", "access", "spaces", "governance", "backup", "audit", "home", "tasks", "files", "chat", "projects"], ["devices"]]) {
    try { const s = await bootFlowSpace(set); console.log("SURVEY BOOT OK", set.join()); await s.stop(); } catch (e) { console.log("SURVEY BOOT REFUSED", set.join(), "\n", (e as Error).message); }
  }
});
