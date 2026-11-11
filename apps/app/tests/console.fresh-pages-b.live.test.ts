// A client's first look at the Console on a fresh Space, part B (the walk is in console-fresh.ts).
import test from "node:test";
import { runFreshPages } from "./console-fresh.ts";

test("fresh Space, every Console page of these places as the owner: no error text, nothing stuck on Loading, no raw id as a name, no refused read", async (t) => {
  await runFreshPages(t, ["Messaging", "Apps", "Computers", "Security", "Space"]);
});
