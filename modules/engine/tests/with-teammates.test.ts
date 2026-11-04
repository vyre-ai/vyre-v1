// "Tell Andrey ...": a name the person typed also names the teammate (lane l-agentdm), so the Gate lets message_person to that person through this turn. Read as the person; no match adds nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { withTeammates } from "../handlers/bridge.ts";

const people = [{ id: "usr_andrey", name: "Andrey Petrov" }, { id: "usr_rubab", name: "Rubab Khan" }, { id: "usr_andreya", name: "Andreya Lin" }];
const call = async (cap: string, input: unknown): Promise<unknown> => {
  assert.equal(cap, "access.principals.list");
  const q = String((input as { q?: string }).q ?? "");
  return { principals: people.filter((p) => p.name.toLowerCase().includes(q)) };
};

test("a send to a first or last name adds the person it names; other acts, addresses and unknown names add nothing", async () => {
  assert.deepEqual(await withTeammates(call, [{ act: "send", target: "andrey" }]), [{ act: "send", target: "andrey" }, { act: "send", target: "usr_andrey" }, { act: "send", target: "andrey-drey" }], "Andreya is not Andrey; the handle people_status gives is let through too");
  assert.deepEqual((await withTeammates(call, [{ act: "send", target: "khan" }])).map((a) => a.target), ["khan", "usr_rubab", "rubab-ubab"]);
  assert.deepEqual(await withTeammates(call, [{ act: "post", target: "andrey" }, { act: "send", target: "lee@acme.test" }, { act: "send", target: "zed" }, { act: "send", target: "" }]),
    [{ act: "post", target: "andrey" }, { act: "send", target: "lee@acme.test" }, { act: "send", target: "zed" }, { act: "send", target: "" }]);
  assert.deepEqual(await withTeammates(async () => { throw new Error("no directory"); }, [{ act: "send", target: "andrey" }]), [{ act: "send", target: "andrey" }]);
});
