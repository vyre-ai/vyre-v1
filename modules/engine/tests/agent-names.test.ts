// The engine names an agent with the one resolver: access.principals.get (an agent the reader may see by its name, someone else's private agent as "<Person> (Agent)"), never a raw id, and never by a call that is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { UNNAMED_AGENT, agentDisplay } from "../agent-names.ts";

const notFound = (): Promise<never> =>
  Promise.reject(Object.assign(new Error("No such principal."), { code: "validation.not_found" }));

test("an agent the reader may see is named by access, as itself", async () => {
  const call = async (cap: string): Promise<unknown> =>
    cap === "access.principals.get" ? { principal: { name: "Docs" } } : notFound();
  assert.deepEqual(await agentDisplay(call, "agt_docs"), { name: "Docs" });
});

test("someone else's private agent is named as its person, and naming it makes no refused call", async () => {
  const seen: string[] = [];
  const refused: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    seen.push(cap);
    if (cap === "agents.get") {
      refused.push(cap);
      return Promise.reject(Object.assign(new Error("That agent is private."), { code: "validation.not_found" }));
    }
    assert.deepEqual(input, { principal: { kind: "agent", id: "agt_simba" } });
    return { principal: { name: "Olivia Reyes (Agent)" } };
  };
  assert.deepEqual(await agentDisplay(call, "agt_simba"), { name: "Olivia Reyes (Agent)" });
  assert.deepEqual(seen, ["access.principals.get"]);
  assert.deepEqual(refused, [], "a display name needs no permission probe");
});

test("nobody can name it: a plain word, never the id", async () => {
  assert.deepEqual(await agentDisplay(notFound, "agt_gone"), { name: UNNAMED_AGENT });
  const echo = async (): Promise<unknown> => ({ principal: { name: "agt_odd" } });
  assert.deepEqual(await agentDisplay(echo, "agt_odd"), { name: UNNAMED_AGENT });
});
