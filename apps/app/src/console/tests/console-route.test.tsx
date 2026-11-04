// How other places open the Console on a machine: console.page with page "machines~<id>" (the prototype's route), and the old ids still redirect.
import test from "node:test";
import assert from "node:assert/strict";
import { machinesTarget, parseConsolePage } from "../shell/route.ts";
import { consolePageFor } from "../../shell/providers/console.tsx";

test("machinesTarget builds console.page with machines~<id>, and the Space server when there is none", () => {
  assert.deepEqual(machinesTarget("srv_box"), { screen: "console.page", args: { page: "machines~srv_box" } });
  assert.deepEqual(machinesTarget("device:dev_mbp"), { screen: "console.page", args: { page: "machines~device:dev_mbp" } });
  assert.deepEqual(machinesTarget(), { screen: "console.page", args: { page: "machines~space" } });
  assert.deepEqual(machinesTarget(""), { screen: "console.page", args: { page: "machines~space" } });
});

test("the route opens Computers with that machine: the page is machines and the machine id is the page's argument", () => {
  assert.deepEqual(parseConsolePage("machines~srv_box"), { page: "machines", args: { machineId: "srv_box" } });
  assert.deepEqual(parseConsolePage("machines~space"), { page: "machines", args: { machineId: "space" } });
  assert.deepEqual(parseConsolePage("machines~device:dev_mbp"), { page: "machines", args: { machineId: "device:dev_mbp" } });
  const el = consolePageFor("machines", parseConsolePage("machines~srv_box")!.args) as unknown as { key: string; props: { initialId?: string } };
  assert.equal(el.props.initialId, "srv_box", "the machine's page opens");
  assert.equal(el.key, "srv_box", "a new machine remounts the page");
  assert.equal((consolePageFor("machines", {}) as unknown as { props: { initialId?: string } }).props.initialId, undefined, "no id, the list");
});

test("a plain page id and the old ids work in the same route, and nothing usable is null", () => {
  assert.deepEqual(parseConsolePage("audit"), { page: "audit", args: {} });
  assert.deepEqual(parseConsolePage("connections"), { page: "apps", args: {} });
  assert.deepEqual(parseConsolePage("computers"), { page: "machines", args: {} });
  assert.equal(parseConsolePage(undefined), null);
  assert.equal(parseConsolePage(""), null);
});
