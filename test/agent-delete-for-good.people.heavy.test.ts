// @heavy docker
// F77, other people. Maya owns an agent (Dex) that Ana and Ben use: each has a chat with it and their own place on its computer. Ben, a plain member, empties Trash and tries to purge the agent's folder and to
// delete it for good: the agent, its chats and its computer are all still there. Maya's confirm counts and names Ana and Ben; each is told when the agent goes to Trash (with the day it will be erased) and
// again when it is erased.
import test from "node:test";
import assert from "node:assert/strict";
import { docker, world } from "./support/agentpc-world.ts";
import { waitFor } from "./support/eco-live.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE";

test("a member cannot erase someone else's agent through Files; the people who lose a chat or a folder are counted and told", { skip, timeout: 600_000 }, async () => {
  const w = await world();
  try {
    for (const [who, key] of [
      [w.ana, "ana-1"],
      [w.ben, "ben-1"],
    ] as const)
    {
      const got = await w.turn(who, key, [{ cmd: "pwd" }]);
      assert.ok(got[0]?.ok, `each works on the computer: ${JSON.stringify(got)}`);
    }
    const dex = (await w.owner.call("agents.get", { agentId: w.agent })).data.agent as { folderId: string };
    assert.equal((await w.owner.call("agents.delete", { agentId: w.agent })).status, 200);
    // Ben, a plain member: Empty Trash, the folder purge and the press itself change nothing
    await w.ben.call("files.trash.empty", {});
    const purge = await w.ben.call("files.folder.purge", { folderId: dex.folderId });
    assert.notEqual(purge.status, 200);
    const press = await w.ben.call("agents.delete_for_good", { agentId: w.agent });
    assert.equal(press.status, 404, "to a stranger the agent does not exist");
    await new Promise((r) => setTimeout(r, 4_000));
    const row = ((await w.owner.call("agents.trash.list", {})).data.agents as Array<{ agentId: string; deleting: boolean }>).find((a) => a.agentId === w.agent);
    assert.ok(row && row.deleting === false, "the agent is still in Trash, not being erased");
    assert.equal((await w.owner.call("files.folder.get", { folderId: dex.folderId })).status, 200, "its folder is still there");
    const vols = (await docker(["volume", "ls", "--format", "{{.Name}}"])).out.split("\n").filter((v) => v.includes(w.agent));
    assert.ok(vols.length >= 1, "its computer's volumes are still there");
    // the confirm counts and names them
    const preview = await w.owner.call("agents.delete_preview", { agentId: w.agent });
    const names = (l: Array<{ name: string }>): string[] => l.map((p) => p.name).sort();
    const chat = names(preview.data.chatPeople);
    assert.ok(chat.includes("Ana Adler") && chat.includes("Ben Brandt"), `the people with a chat are named: ${chat.join(", ")}`);
    assert.ok(preview.data.folderPeople.length >= 2, "the people with their own folder on its computer are counted");
    // each is told at Trash, with the day
    const lines = async (who: typeof w.ana): Promise<string[]> =>
      ((await who.call("tasks.list", { scope: "mine" })).data.tasks as Array<{ title: string }>).map((t) => t.title);
    const trashed = await waitFor(async () => ((await lines(w.ana)).some((t) => /Dex is in Trash\. It will be erased on/.test(t)) ? true : null), 30_000);
    assert.ok(trashed);
    // Maya deletes for good: they are told again
    assert.equal((await w.owner.call("agents.delete_for_good", { agentId: w.agent })).status, 200);
    await waitFor(async () => ((await lines(w.ben)).some((t) => t === "Dex was deleted for good.") ? true : null), 120_000);
    await waitFor(async () => ((await lines(w.ana)).some((t) => t === "Dex was deleted for good.") ? true : null), 60_000);
  } finally {
    await w.close();
  }
});
