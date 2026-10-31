// Every person gets a private assistant when their account exists, with or without an AI account; a repeat delivery makes no second one.
// @reads /modules/agents/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, periodic } from "../impl.ts";
import { assistantNames, possessive } from "../handlers/crud.ts";
import { DANA, LEO, harness } from "../fixtures/harness.ts";

const run = consumers["agents.ensure_assistant"].run;
const born = (id: string, name: string, kind = "person") => ({ payload: { principalId: id, kind, name } });

test("a person's account makes one private assistant owned by them, and a second delivery finds it", async () => {
  const hn = harness();
  const [id] = await run(hn.ctx, born(DANA, "Dana Reyes"));
  assert.match(id!, /^agt_/);
  const again = await run(hn.ctx, born(DANA, "Dana Reyes"));
  assert.deepEqual(again, [id]);
  const listed = (await (await import("../impl.ts")).handlers["agents.list"]!(hn.ctx, { section: "personal", limit: 100 }) as any).agents;
  const mine = listed.filter((a: any) => a.ownerId === DANA);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].role, "assistant");
  assert.equal(mine[0].name, "Dana’s Assistant");
});

test("two people with the same first name each get their own; agents and services get none", async () => {
  const hn = harness();
  const a = await run(hn.ctx, born(DANA, "Dana Reyes"));
  const b = await run(hn.ctx, born(LEO, "Dana Okafor"));
  assert.notDeepEqual(a, b);
  assert.deepEqual(await run(hn.ctx, born("agt_x", "Helper", "agent")), []);
  assert.deepEqual(await run(hn.ctx, born("svc_x", "Service", "service")), []);
});

test("the assistant belongs to its person alone: another member's list does not show it, and the lookup is by what create stores", async () => {
  const { handlers } = await import("../impl.ts");
  const list = handlers["agents.list"] as unknown as (c: unknown, i: unknown) => Promise<{ agents: { agentId: string; ownerId: string; role?: string; name: string }[] }>;
  const get = handlers["agents.get"] as unknown as (c: unknown, i: unknown) => Promise<{ agent: { role?: string } }>;
  const hn = harness();
  const [id] = await run(hn.person(DANA), born(DANA, "Dana Reyes"));
  hn.allowOnly(() => true);   // even a Space where everyone may view every agent, and an admin who sees all: the assistant stays its owner's
  // what the console assistant reads to find it: agentId, ownerId and role === "assistant"
  const mine = (await list(hn.person(DANA), { section: "personal", limit: 100 })).agents.find((a) => a.agentId === id);
  assert.deepEqual(mine && [mine.ownerId, mine.role], [DANA, "assistant"]);
  assert.equal((await get(hn.person(DANA), { agentId: id! })).agent.role, "assistant", "create stores the role the lookup matches");
  // another member: not in any section of their list, and a direct get answers as if it did not exist
  for (const section of ["personal", "shared", "space", undefined]) {
    const seen = (await list(hn.person(LEO), { ...(section ? { section } : {}), limit: 100 })).agents;
    assert.ok(!seen.some((a) => a.agentId === id), `not in ${section ?? "the default list"}`);
  }
  await assert.rejects(() => get(hn.person(LEO), { agentId: id! }), (e: any) => (e?.error?.code ?? e?.code) === "validation.not_found");
  // a second delivery (and a delivery for a differently written name) finds it and makes no duplicate
  assert.deepEqual(await run(hn.person(DANA), born(DANA, "Dana R.")), [id]);
  const again = (await list(hn.person(DANA), { section: "personal", limit: 100 })).agents.filter((a) => a.ownerId === DANA && a.role === "assistant");
  assert.equal(again.length, 1);
});

test("the assistant name is possessive with a typographic apostrophe, and a name ending in s takes none", () => {
  assert.equal(possessive("Irfad"), "Irfad’s");
  assert.equal(possessive("James"), "James’");
  assert.deepEqual(assistantNames("usr_abcdefgh", "Irfad Imtiaz"), ["Irfad’s Assistant", "Irfad’s Assistant abcd", "Assistant abcdef"]);
  assert.deepEqual(assistantNames("usr_abcdefgh", "James Cross"), ["James’ Assistant", "James’ Assistant abcd", "Assistant abcdef"]);
  assert.deepEqual(assistantNames("usr_abcdefgh", undefined), ["Assistant", "My Assistant", "Assistant abcdef"]);
  assert.deepEqual(assistantNames("usr_abcdefgh", "  "), ["Assistant", "My Assistant", "Assistant abcdef"]);
  assert.equal(assistantNames("usr_abcdefgh", "Irfad")[0], "Irfad’s Assistant");
  assert.deepEqual(assistantNames("usr_abcdefgh", "olivia reyes"), ["Olivia’s Assistant", "Olivia’s Assistant abcd", "Assistant abcdef"], "the first name only, its first letter capitalised, never the full name");
  assert.equal(assistantNames("usr_abcdefgh", "olivia", false)[0], "olivia’s Assistant");
});

test("on boot an assistant still called by the old default is renamed with its folder; one the person renamed is not", async () => {
  const { handlers } = await import("../impl.ts");
  const get = handlers["agents.get"] as unknown as (c: unknown, i: unknown) => Promise<{ agent: { name: string; folderId?: string } }>;
  const rename = periodic["agents.assistant_names"].run;
  const hn = harness();
  const people = hn.world.principals as unknown as Array<{ id: string; kind: string; name: string; status: string }>;
  people.push({ id: DANA, kind: "person", name: "Dana Reyes", status: "active" }, { id: LEO, kind: "person", name: "Leo James", status: "active" });
  const [dana] = await run(hn.person(DANA), born(DANA, "Dana Reyes"));
  const [leo] = await run(hn.person(LEO), born(LEO, "Leo James"));
  // make both look like a Space from before the rule: the old default name, written the way the old code did
  const update = handlers["agents.update"] as unknown as (c: unknown, i: unknown) => Promise<unknown>;
  await update(hn.person(DANA), { agentId: dana!, patch: { name: "Dana Assistant" } });
  await update(hn.person(LEO), { agentId: leo!, patch: { name: "Leo Helper" } });   // renamed by hand: never touched
  assert.deepEqual(await rename(hn.ctx), [dana]);
  assert.equal((await get(hn.person(DANA), { agentId: dana! })).agent.name, "Dana’s Assistant");
  assert.equal((await get(hn.person(LEO), { agentId: leo! })).agent.name, "Leo Helper");
  assert.deepEqual(await rename(hn.ctx), [], "a second boot finds nothing to do");
  const folder = hn.world.calls.filter((c) => c.cap === "files.folder.rename").map((c) => (c.input as { name: string }).name);
  assert.ok(folder.includes("Dana’s Assistant"), "the folder followed the name");
});

test("a changed display name moves an assistant that wears the default; one the person renamed stays", async () => {
  const { handlers } = await import("../impl.ts");
  const get = handlers["agents.get"] as unknown as (c: unknown, i: unknown) => Promise<{ agent: { name: string } }>;
  const update = handlers["agents.update"] as unknown as (c: unknown, i: unknown) => Promise<unknown>;
  const changed = consumers["agents.assistant_rename"].run;
  const hn = harness();
  const [dana] = await run(hn.person(DANA), born(DANA, "Dana Reyes"));
  const [leo] = await run(hn.person(LEO), born(LEO, "Leo James"));
  await update(hn.person(LEO), { agentId: leo!, patch: { name: "Scout" } });
  const ev = (person: string, before: string, after: string, key = "profile.display_name") => ({ payload: { key, scope: "person", person, before, after } });
  assert.deepEqual(await changed(hn.ctx, ev(DANA, "Dana Reyes", "Ines Reyes")), [dana]);
  assert.equal((await get(hn.person(DANA), { agentId: dana! })).agent.name, "Ines’ Assistant");
  assert.deepEqual(await changed(hn.ctx, ev(LEO, "Leo James", "Leon James")), [], "a name the person chose is kept");
  assert.deepEqual(await changed(hn.ctx, ev(DANA, "Ines Reyes", "Ines Reyes", "profile.title")), [], "other settings are ignored");
});

test("on boot with the people list not readable, the exact old shape '<First> Assistant' is still renamed; other names are not", async () => {
  const { handlers } = await import("../impl.ts");
  const get = handlers["agents.get"] as unknown as (c: unknown, i: unknown) => Promise<{ agent: { name: string } }>;
  const update = handlers["agents.update"] as unknown as (c: unknown, i: unknown) => Promise<unknown>;
  const hn = harness();
  const [dana] = await run(hn.person(DANA), born(DANA, "Dana Reyes"));
  const [leo] = await run(hn.person(LEO), born(LEO, "Leo James"));
  await update(hn.person(DANA), { agentId: dana!, patch: { name: "Dana Assistant" } });
  await update(hn.person(LEO), { agentId: leo!, patch: { name: "Leo Reyes Helper" } });
  assert.deepEqual(await periodic["agents.assistant_names"].run(hn.ctx), [dana], "no principals in the world, the name shape alone decides");
  assert.equal((await get(hn.person(DANA), { agentId: dana! })).agent.name, "Dana’s Assistant");
  assert.equal((await get(hn.person(LEO), { agentId: leo! })).agent.name, "Leo Reyes Helper");
  assert.equal(periodic["agents.assistant_names"].everyMs, 15 * 60_000, "it retries, so a list that was not ready at boot is not missed for a week");
});
