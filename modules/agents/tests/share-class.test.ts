// How an agent is shared (classifyAgent, agents.share_class): the one rule the Space browser uses for who may watch an agent's work.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyAgent } from "../handlers/crud.ts";
import type { AgentRec, AgentsCtx } from "../projections.ts";

const agent = (over: Partial<AgentRec> = {}) => ({ id: "agt_dex", ownerId: "usr_dana", kind: "agent", runtime: "vyre", ...over }) as unknown as AgentRec;
const ctxWith = (subjects: Array<{ kind: string; id: string }> | "throws" | "none"): AgentsCtx => ({
  async call(cap: string) {
    if (cap !== "access.shares_of") throw new Error(cap);
    if (subjects === "throws") throw new Error("denied");
    return { shares: subjects === "none" ? [] : subjects.map((subject) => ({ grant: { subject } })) };
  },
}) as unknown as AgentsCtx;

test("an Assistant and an outside agent are private, whatever was shared", async () => {
  assert.deepEqual(await classifyAgent(ctxWith([{ kind: "group", id: "grp_everyone" }]), agent({ kind: "assistant" })), { class: "private", people: [] });
  assert.deepEqual(await classifyAgent(ctxWith("none"), agent({ runtime: "outside" })), { class: "private", people: [] });
});

test("shared with the Everyone group is the whole Space, with named people is shared, with nobody is personal", async () => {
  assert.equal((await classifyAgent(ctxWith([{ kind: "group", id: "grp_everyone" }, { kind: "person", id: "usr_omar" }]), agent())).class, "space");
  assert.deepEqual(await classifyAgent(ctxWith([{ kind: "person", id: "usr_omar" }, { kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_omar" }]), agent()), { class: "shared", people: ["usr_omar"] });
  assert.equal((await classifyAgent(ctxWith([{ kind: "group", id: "grp_sales" }]), agent())).class, "shared", "a named group is shared too");
  assert.equal((await classifyAgent(ctxWith("none"), agent())).class, "personal");
});

test("what cannot be read is not shared: the narrower answer", async () => {
  assert.equal((await classifyAgent(ctxWith("throws"), agent())).class, "personal");
});
