// A client's first look at Settings on a fresh Space (the walk is in console-fresh.ts): every page of You and the Space, no error text, no raw id, no server listed twice or never seen.
import test from "node:test";
import { runFreshPages } from "./console-fresh.ts";

test("fresh Space, every Settings page as the owner: no error text, no raw id, no phantom server", async (t) => {
  await runFreshPages(t, ["Settings"], { settings: true });
});
