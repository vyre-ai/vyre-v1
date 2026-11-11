// The Projects shell in a real browser against the production export and a claimed daemon: as the owner (admin) on a wide screen. One walk per file keeps each under the 120 s file cap; the walk is in projects-shell-kit.ts. Shots go to VYRE_PROJECTS_SHOTS.
import test from "node:test";
import { projectsShellWalk } from "./projects-shell-kit.test.ts";

test("Projects shell as an admin, wide: sidebar group, project tab, header, tabs and status", async (t) => { await projectsShellWalk(t, "admin", "wide"); });
