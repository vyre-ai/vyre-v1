// The watchdog names what still runs in a file's process group before it ends the group (13 Nov 2026: memory.recall.live sat 122 s after its tests with no word on what held it).
import test from "node:test";
import assert from "node:assert/strict";
import { groupTree, killGroup, spawnGroup } from "./proc-group.mjs";

test(
  "groupTree lists the processes of a group, including a grandchild that holds the pipe",
  { skip: process.platform === "win32" },
  async () => {
    // a shell that starts a long sleep with the shell's own stdout and waits for it: the shape of a file whose node exited while a child kept the output pipe
    const p = spawnGroup("sh", ["-c", "sleep 30 & wait"], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      let lines: string[] = [];
      for (let i = 0; i < 100 && !lines.some((l) => l.includes("sleep 30")); i++) {
        lines = groupTree(p.pid ?? 0);
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(
        lines.some((l) => l.includes("sleep 30")),
        `the sleep is named: ${JSON.stringify(lines)}`,
      );
      assert.ok(
        lines.some((l) => l.includes(`pid ${p.pid} `)),
        "and the shell that leads the group",
      );
    } finally {
      assert.equal(await killGroup(p), true);
    }
    assert.deepEqual(groupTree(p.pid ?? 0), [], "nothing is listed once the group is gone");
  },
);
