// "Runs on" in the agent pane opens Console > Computers with that machine selected: the route is machines~<id>, and the Space's own server is machines~space.
import test from "node:test";
import assert from "node:assert/strict";
import { machinesTarget } from "../../../console/shell/route.ts";   // data.ts wires openMachines to this one helper

test("Runs on goes to machines~<id>, and to machines~space when the machine is the Space's own", () => {
  assert.deepEqual(machinesTarget("node_berlin"), { screen: "console.page", args: { page: "machines~node_berlin" } });
  assert.deepEqual(machinesTarget(), { screen: "console.page", args: { page: "machines~space" } });
  assert.deepEqual(machinesTarget(""), { screen: "console.page", args: { page: "machines~space" } });
});
