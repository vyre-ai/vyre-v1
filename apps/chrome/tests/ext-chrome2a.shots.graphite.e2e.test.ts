// The extension's own pieces for Chrome step 2 part A in the graphite skin (dark page), at 1440 and 390: see e2e/c2a-shots.ts. Photographs go to VYRE_SHOT_DIR.
import test from "node:test";
import { found, shootExtension } from "./e2e/c2a-shots.ts";

test("the extension's pieces, graphite, at 1440 and 390", { skip: !found && "no Chromium on this machine", timeout: 120_000 }, () => shootExtension("dark", "graphite"));
