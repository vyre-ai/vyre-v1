// F77: erasing an agent's computer while the daemon has not yet said what runtime the Space has does not skip it: the step fails so the job tries again, and works once the host is bound.
import test from "node:test";
import assert from "node:assert/strict";
import { hostCalls, setTerminalHost } from "../impl.ts";
import { harness, reset } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";

const erase = hostCalls["terminal.erase_agent"] as (ctx: unknown, i: unknown) => Promise<unknown>;

test("with the workspace manager not bound yet the step throws; once the host is bound (no runtime) it clears the rows", async () => {
  reset();
  const h = harness();
  await assert.rejects(erase(h.ctx, { agentId: "agt_desk", dry: false }), /not ready/);
  setTerminalHost(null);
  await erase(h.ctx, { agentId: "agt_desk", dry: false });
});

test("a person with a place on the computer and no session row is named, and the erase leaves no place row", async () => {
  reset();
  const h = harness();
  ensure(h.db as never);
  h.db.run("INSERT INTO terminal_person_places (agent_id, person) VALUES (?, ?)", "agt_desk", "usr_noah");
  h.db.run("INSERT INTO terminal_person_places (agent_id, person) VALUES (?, ?)", "agt_other", "usr_leo");
  setTerminalHost(null);
  const seen = (await erase(h.ctx, { agentId: "agt_desk", dry: true })) as { folderPeople: string[] };
  assert.deepEqual(seen.folderPeople, ["usr_noah"]);
  await erase(h.ctx, { agentId: "agt_desk", dry: false });
  assert.deepEqual(
    h.db.all("SELECT agent_id, person FROM terminal_person_places"),
    [{ agent_id: "agt_other", person: "usr_leo" }],
    "only this agent's place rows went",
  );
});
