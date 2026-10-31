// Can an agent computer run here? A Team Space says yes; a Personal Space says no until a host has said it can, and everyone who asked hears the change.
import test from "node:test";
import assert from "node:assert/strict";
import { computersAvailableNow, refreshComputersAvailable, resetComputersAvailable, setComputersAvailable } from "./computers-available.ts";

const personal = { id: "spc_me", kind: "personal" as const };

test("a Team Space can always, a Personal Space only once a host says so", async () => {
  resetComputersAvailable();
  assert.equal(computersAvailableNow({ id: "spc_t", kind: "team" }), true);
  assert.equal(computersAvailableNow(personal), false);
  const asked: string[] = [];
  const rt = (available: unknown) => ({ space: personal, call: async (cap: string): Promise<unknown> => { asked.push(cap); return { available }; } });
  assert.equal(await refreshComputersAvailable(rt(true)), true);
  assert.equal(computersAvailableNow(personal), true);
  assert.equal(await refreshComputersAvailable(rt(false)), false, "the last server went away");
  assert.deepEqual(asked, ["computers.hosts", "computers.hosts"]);
  assert.equal(await refreshComputersAvailable({ space: { id: "spc_t", kind: "team" }, call: async () => { throw new Error("never asked"); } }), true);
  const failing = { space: personal, call: async (): Promise<unknown> => { throw new Error("offline"); } };
  setComputersAvailable(personal.id, true);
  assert.equal(await refreshComputersAvailable(failing), true, "a failed ask changes nothing");
  resetComputersAvailable();
});
