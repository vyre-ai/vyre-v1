// Sweep: every control with a test id on this page is pressed once, as a Member; none may throw. (The ones that write are asserted in controls.test.tsx.)
import test from "node:test";
import { sweep } from "./controls-sweep.support.tsx";

test("profile as member: every control can be pressed", async () => { await sweep("profile", "member"); });
