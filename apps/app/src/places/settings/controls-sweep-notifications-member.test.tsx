// Sweep: every control with a test id on this page is pressed once, as a Member; none may throw. (The ones that write are asserted in controls.test.tsx.)
import test from "node:test";
import { createRoot } from "test-renderer";
import { sweep } from "./controls-sweep.support.tsx";

test("notifications as member: every control can be pressed", async () => { await sweep(createRoot, "notifications", "member"); });
