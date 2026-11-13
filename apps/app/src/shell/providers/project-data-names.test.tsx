// The production Project page directory is the shared resolver (the Overview test's sample has its own nameOf, so it cannot prove this).
import test from "node:test";
import assert from "node:assert/strict";
import { NAME_LOADING } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

const rt = (ready: boolean): ShellRuntime =>
  ({
    me: { id: "usr_me", name: "Olivia Park" },
    space: { id: "spc_x", kind: "team", name: "X" },
    clock: () => ({ now: 0 }),
    principals: {
      subscribe: () => () => undefined,
      getSnapshot: () =>
        ready
          ? { status: "ready", data: [{ id: "usr_maya", name: "Maya Chen", kind: "person" }] }
          : { status: "loading" },
    },
  }) as unknown as ShellRuntime;

test("the Project page's own directory is the shared resolver: a member the directory lacks reads Someone, never the id (production wiring, not the sample)", async () => {
  const { projectPageData } = await import("./project-data.ts");
  const data = projectPageData(rt(true));
  assert.equal(data.nameOf("usr_maya"), "Maya Chen");
  assert.equal(data.nameOf("usr_gone0123456789ab"), "Someone");
  assert.equal(projectPageData(rt(false)).nameOf("usr_maya"), NAME_LOADING);
});
