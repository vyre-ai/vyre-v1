// The Projects shell in a real browser against the production export and a claimed daemon: as Maya, a member, on a phone. One walk per file keeps each under the 120 s file cap; the walk is in projects-shell-kit.ts. Shots go to VYRE_PROJECTS_SHOTS.
import test from "node:test";
import { projectsShellWalk } from "./projects-shell-kit.ts";

test("Projects shell as a member, on a phone: project tab, header and tabs", async (t) => { await projectsShellWalk(t, "member", "phone"); });
