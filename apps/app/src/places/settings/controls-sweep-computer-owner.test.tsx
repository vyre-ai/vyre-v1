// Sweep: every control with a test id on this page is pressed once, as an Owner; none may throw. (The ones that write are asserted in controls.test.tsx.)
import test from "node:test";
import { sweep } from "./controls-sweep.support.tsx";
// the device page polls its machines and the updater; a poll must not keep the test process alive
for (const k of ["setInterval", "setTimeout"] as const) { const orig = globalThis[k] as (...a: unknown[]) => { unref?: () => void }; (globalThis as Record<string, unknown>)[k] = (...a: unknown[]) => { const h = orig(...a); h?.unref?.(); return h; }; }

test("computer as owner: every control can be pressed", async () => { await sweep("computer", "owner"); });
