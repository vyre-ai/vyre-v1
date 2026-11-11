// @heavy docker
// The agent's home never follows a link (P-L2_35): a symlink on the computer is never read or sent, and a folder that is a link to the host is never followed, down or up, and cleaning it up does not reach the host.
// One of the tests that replace computers.live.test.ts, split by behaviour (host/tests/computers.kit.ts holds what they share); each runs in its own job so none is the floor under the push budget. Runs only with VYRE_HEAVY_DOCKER=1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, call, ensureImage, finish, homeKit, seededDir, skip, wakeComputer } from "./computers.kit.ts";

test("computers live: the agent's home never follows a symlink, nor a folder that links to the host", { skip }, async () => {
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
    const { HOME, inBox, until, filesIn, onDisk, passes } = homeKit(d, dir, agentId, box, folderId);

    // the folder arrives on the computer, and AGENT.md is read-only there
    await until("AGENT.md on the computer", async () => (await onDisk("AGENT.md")) !== null);
    assert.equal((await inBox(`test ! -w ${HOME}/AGENT.md`)).code, 0, "AGENT.md is read-only on the computer");

    // a symlink is never read or sent
    await inBox(`ln -s /etc/passwd ${HOME}/link.txt`);
    await passes("after-link");
    assert.ok(!(await filesIn(folderId)).files.some((f) => f.name === "link.txt"), "a symlink did not reach Files");

    // a folder that is a link to the host: the daemon never follows it, down or up
    const hostTmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-escape-"));
    fs.writeFileSync(path.join(hostTmp, "host-secret.txt"), "host secret");
    fs.symlinkSync(hostTmp, path.join(dir, "computers", agentId, "Vyre", "escape"));
    const escDir = await call(d, "files.folder.create", { parentId: folderId, name: "escape", idempotencyKey: "home-escape" });
    assert.equal(escDir.status, 200, JSON.stringify(escDir.data));
    await call(d, "files.create", { folderId: escDir.data.folder.folderId, name: "pwn.txt", content: { text: "pwned" }, idempotencyKey: "home-escape-file" });
    await passes("after-escape");
    assert.deepEqual(fs.readdirSync(hostTmp), ["host-secret.txt"], "nothing was written through the link on the host");
    const inEscape = await filesIn(escDir.data.folder.folderId as string);
    assert.ok(!inEscape.files.some((f) => f.name === "host-secret.txt"), "nothing was read through the link into Files");
    assert.ok(!(await filesIn(folderId)).files.some((f) => f.name === "host-secret.txt"), "the host file is not in the agent's folder either");
    const removedEscape = await inBox(`rm -rf -- ${HOME}/escape`);
    assert.equal(removedEscape.code, 0, `cleaning up the escape fixture failed: ${removedEscape.out}`);
    assert.deepEqual(fs.readdirSync(hostTmp), ["host-secret.txt"], "cleanup did not follow the link to its host target");
    fs.rmSync(hostTmp, { recursive: true, force: true });
  } finally {
    await finish(d, computerId);
  }
});
