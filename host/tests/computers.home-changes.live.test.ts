// @heavy docker
// The agent's home when both sides change (P-L2_35): both sides editing one file between two passes keeps the path in Files, lands the computer's version beside it and gives the owner a task; taking access away removes the file from the computer.
// One of the tests that replace computers.live.test.ts, split by behaviour (host/tests/computers.kit.ts holds what they share); each runs in its own job so none is the floor under the push budget. Runs only with VYRE_HEAVY_DOCKER=1.
import test from "node:test";
import assert from "node:assert/strict";



import { boot, call, ensureImage, finish, homeKit, seededDir, skip, wakeComputer } from "./computers.kit.ts";

test("computers live: both sides editing one file leaves a conflict copy and a task, and taking access away removes the file", { skip }, async () => {
  await ensureImage();
  const dir = seededDir();
  const d = await boot(dir);
  let computerId = "";
  try {
    assert.deepEqual(d.seams?.missing, [], "no live module is left without its driver");
    assert.ok(d.seams?.wired.includes("setComputerHost"), "the computers seam is wired");

    const woken = await wakeComputer(d);
    const { agentId, box } = woken;
    computerId = woken.computerId;
    const folderId = (await call(d, "agents.get", { agentId })).data.agent.folderId as string;
    const { HOME, inBox, until, filesIn, textOf, onDisk, passes } = homeKit(d, dir, agentId, box, folderId);

    // the folder arrives on the computer, and AGENT.md is read-only there
    await until("AGENT.md on the computer", async () => (await onDisk("AGENT.md")) !== null);
    assert.equal((await inBox(`test ! -w ${HOME}/AGENT.md`)).code, 0, "AGENT.md is read-only on the computer");

    // both sides edit the same file between two passes: Files keeps the path, the computer's version lands beside it, and the owner gets a task
    await call(d, "files.create", { folderId, name: "both.txt", content: { text: "start" }, idempotencyKey: "home-both" });
    await until("both.txt on the computer", async () => await onDisk("both.txt"));
    const both = (await filesIn(folderId)).files.find((f) => f.name === "both.txt")!;
    await inBox(`printf 'computer wrote this' > ${HOME}/both.txt`);
    const w = await call(d, "files.write", { fileId: both.fileId, content: { text: "vyre wrote this" }, reason: "test" });
    assert.equal(w.status, 200, JSON.stringify(w.data));
    const copy = await until("the conflict copy in Files", async () => (await filesIn(folderId)).files.find((f) => f.name === "both (from computer).txt"));
    assert.equal(await textOf(copy.fileId), "computer wrote this");
    assert.equal(await textOf(both.fileId), "vyre wrote this", "Files kept the original path");
    assert.equal((await until("the computer shows Files' version", async () => { const t = await onDisk("both.txt"); return t === "vyre wrote this\n" ? t : null; })).length > 0, true);
    const tasks = await call(d, "tasks.list", { scope: "all" });
    assert.ok(JSON.stringify(tasks.data).includes("A file changed in two places: both.txt"), "the agent's owner has a task for the conflict");

    // access taken away: the file leaves the computer
    const secret = await call(d, "files.folder.create", { parentId: folderId, name: "secret", idempotencyKey: "home-secret" });
    assert.equal(secret.status, 200, JSON.stringify(secret.data));
    const secretId = secret.data.folder.folderId as string;
    await call(d, "files.create", { folderId: secretId, name: "s.txt", content: { text: "hidden soon" }, idempotencyKey: "home-secret-file" });
    await until("secret/s.txt on the computer", async () => await onDisk("secret/s.txt"));
    const lab = await call(d, "files.folder.settings", { folderId: secretId, label: "restricted" });
    assert.equal(lab.status, 200, JSON.stringify(lab.data));
    await until("secret/s.txt gone from the computer", async () => (await inBox(`test ! -e ${HOME}/secret/s.txt`)).code === 0);
  } finally {
    await finish(d, computerId);
  }
});
