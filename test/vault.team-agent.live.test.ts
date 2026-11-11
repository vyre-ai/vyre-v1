// The team-agent rule for Vault values on a booted daemon (host/src/seams/team-vault.ts, owner rule 12 Nov): the lookup the daemon hands the terminal (and the browser fill) uses an item in a team
// agent's computer only if the agent itself holds Use on it, by the real access engine; in the asker's own Assistant nothing changes. Nothing inside the daemon is faked.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { boot, call, connect, makeAgent, seededDir } from "./support/live.ts";
import { bindHost, bindKit, bindPlace, boundValues } from "../modules/terminal/projections.ts";
import { handlers as terminal } from "../modules/terminal/impl.ts";
import { fakeHost, harness as termHarness, reset as termReset } from "../modules/terminal/fixtures/harness.ts";

let keys = 0;
/** A write, with the idempotency key every write takes. */
const write = (d: Parameters<typeof call>[0], cap: string, input: Record<string, unknown>) => call(d, cap, { idempotencyKey: `ta-${++keys}`, ...input });

test("team agent: private and asker-only items are refused; shared with the agent, a group it is in or the whole Space is used; the asker's own Assistant uses them all", async () => {
  const dir = seededDir();
  const d = await boot(dir, null);
  try {
    await connect(d);
    const team = await makeAgent(d, "Deployer", "You deploy.");
    // Olivia's Assistant: the seed's people were made before the agents module, so none was made for her; an agent of hers is marked as one, as onPersonCreated would have made it
    const ownId = await makeAgent(d, "Olivia Assistant", "You help Olivia.");
    const { DatabaseSync } = await import("node:sqlite");
    const mdb = new DatabaseSync(path.join(dir, "modules.db"));
    mdb.prepare(`UPDATE agents_agent SET "kind" = 'assistant' WHERE "id" = ?`).run(ownId);
    mdb.close();
    const own = { agentId: ownId };
    const mineFolder = (await write(d, "vault.folders.create", { name: "Mine keys", scope: "mine" })).data.folder.id as string;
    const shared = (await write(d, "vault.folders.create", { name: "Team keys", scope: "shared" })).data.folder.id as string;
    const put = async (folderId: string, name: string): Promise<string> => {
      const r = await write(d, "vault.item.put", { folderId, name, kind: "api_key", fields: [{ key: "key", value: `v-${name}-0123456789`, secret: true }] });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.item?.id ?? r.data.itemId;
    };
    await put(mineFolder, "Olivia Private");
    await put(shared, "Olivia Only");
    const toAgent = await put(shared, "For Deployer");
    const toSpace = await put(shared, "For Everyone");
    const toGroup = await put(shared, "For Deploy Group");
    const share = async (id: string, subject: { kind: string; id: string }) => assert.equal((await write(d, "vault.share", { resource: { type: "vault_item", id }, subject, level: "use" })).status, 200);
    await share(toAgent, { kind: "agent", id: team });
    // Tess (a temp: no grant on the Space) may ask the team agent, so an item only Olivia and the members hold is not one everyone who asks it may use
    const askable = await write(d, "access.share", { resource: { type: "agent", id: team }, subject: { kind: "person", id: "usr_tess" }, level: "use" });
    assert.equal(askable.status, 200, JSON.stringify(askable.data));
    await share(toSpace, { kind: "group", id: "grp_everyone" });
    const grp = await write(d, "access.groups.create", { name: "Deploy group", members: [{ kind: "agent", id: team }] });
    assert.equal(grp.status, 200, JSON.stringify(grp.data));
    await share(toGroup, { kind: "group", id: grp.data.group.id });
    // also shared with Olivia herself, so only "the agent" differs
    const values = boundValues();
    assert.ok(values, "the daemon hands the terminal the Space's Vault");
    const ask = async (handle: string, agentId: string) => (await values!.lookup(handle, { agentId, asker: "usr_olivia", where: "computer", place: agentId })).kind + ":" + String((await values!.lookup(handle, { agentId, asker: "usr_olivia", where: "computer", place: agentId }) as { reason?: string }).reason ?? "");
    assert.equal(await ask("#Olivia_Private.key", team), "denied:team_agent", "a private item in a team agent");
    assert.equal(await ask("#Olivia_Only.key", team), "denied:team_agent", "an item shared only with the asker, in a team agent");
    assert.equal(await ask("#For_Deployer.key", team), "value:", "shared with the agent");
    assert.equal(await ask("#For_Deploy_Group.key", team), "value:", "a group grant that includes the agent");
    assert.equal(await ask("#For_Everyone.key", team), "value:", "shared with the whole Space");
    assert.equal(await ask("#Olivia_Private.key", own!.agentId), "value:", "a private item in the asker's own Assistant");
    assert.equal(await ask("#Olivia_Only.key", own!.agentId), "value:", "an item shared only with the asker, in the asker's own Assistant");

    // third look F1: the scrubber as an oracle. A team agent's workspace never takes a value of an item it may not hold, so it never remembers or scrubs it: Tess, asking the same agent to print
    // candidates, gets them all back as printed, and no line coming back replaced tells her which one is Olivia's.
    termReset();
    bindKit(null);   // the real scrubber; the Vault is the daemon's own (boundValues above)
    const PIN = "v-Olivia Private-0123456789";
    const candidates = ["v-Olivia Private-0123456788", PIN, "v-Olivia Private-0123456790"];
    const host = fakeHost({ "use pin": { exitCode: 0, output: "ok" }, "print candidates": { exitCode: 0, output: candidates.join("\n") } });
    bindHost(host.host);
    // the team agent's own computer (its workspace), whoever asks
    bindPlace(async () => ({ team: true, agentComputer: true, runsOn: "agent_computer" }));
    const th = termHarness();
    const tc = terminal as unknown as Record<string, (ctx: unknown, input: unknown) => Promise<{ output: string }>>;
    let refused = "";
    try { await tc["terminal.run"]!(th.as({ kind: "agent", id: team }, "usr_olivia"), { command: "use pin", env: { K: "#Olivia_Private.key" }, idempotencyKey: "f1-a" }); } catch (e) { refused = JSON.stringify(e); }
    assert.match(refused, /is your own item, and this is a team agent/, "Olivia's private item never reaches the team agent's workspace");
    const out = await tc["terminal.run"]!(th.as({ kind: "agent", id: team }, "usr_tess"), { command: "print candidates", idempotencyKey: "f1-b" });
    assert.deepEqual(out.output.split("\n"), candidates, "every candidate comes back as printed: nothing marks the private one");
    termReset();
  } finally { await d.stop(); }
});
