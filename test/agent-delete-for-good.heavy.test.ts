// @heavy docker
// F77, the full proof on a real workspace container: three agents each get canaries in the stores they keep (memory, a one-to-one chat with an attachment, a file in its folder, a file in its home on its
// computer, a routine, AGENT.md and an older version of it, a tool trace and run record in the command it ran), each is deleted for good, and the daemon is killed at a different point of the job: right
// after the press, in the middle of the module steps, and after the container is removed and before the row goes. After every boot the job finishes, `docker ps -a` and `docker volume ls` show nothing of
// the agent, and a scan of every table of every database file and of every other file in the data folder finds no canary. Runs only with VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { docker, world } from "./support/agentpc-world.ts";
import { scan } from "./support/canary-scan.ts";
import { waitFor } from "./support/eco-live.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE";

type Job = { state: string; done: number; steps: string[] };
/** One read of the job's row. The handle is kept by the caller, so a tight loop sees each step the moment it is committed. */
const jobOn = (db: DatabaseSync, id: string): Job | null => {
  try {
    const r = db.prepare("SELECT state, doneJson FROM agents_erase WHERE agentId = ?").get(id) as { state: string; doneJson: string } | undefined;
    const steps = r ? (JSON.parse(r.doneJson) as string[]) : [];
    return r ? { state: r.state, done: steps.length, steps } : null;
  } catch {
    return null;
  }
};
const jobRow = (root: string, id: string): Job | null => {
  const db = new DatabaseSync(path.join(root, "modules.db"), { readOnly: true });
  try {
    return jobOn(db, id);
  } finally {
    db.close();
  }
};
/** Spin on the row until `at` says it is the moment, and answer it (null when the job went past). */
const spinUntil = async (root: string, id: string, at: (j: Job) => boolean, ms = 60_000): Promise<Job | null> => {
  const db = new DatabaseSync(path.join(root, "modules.db"), { readOnly: true });
  try {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      const j = jobOn(db, id);
      if (j && at(j)) return j;
      if (j?.state === "erased") return null;
      await new Promise((r) => setImmediate(r));
    }
    return null;
  } finally {
    db.close();
  }
};
const containerOf = async (id: string): Promise<boolean> =>
  (await docker(["ps", "-a", "-q", "--filter", `name=vyre-ws-${id}`])).out.trim() !== "";
const volumesOf = async (id: string): Promise<string[]> =>
  (await docker(["volume", "ls", "--format", "{{.Name}}"])).out.split("\n").filter((v) => v.includes(id));

test("three agents with canaries in every store are deleted for good; the daemon is killed at three points; the scan and docker are clean", { skip, timeout: 900_000 }, async () => {
  const w = await world();
  const report: Record<string, unknown> = {};
  try {
    const kills: Array<"after_press" | "mid_steps" | "container_gone"> = ["after_press", "mid_steps", "container_gone"];
    const agents: Array<{ id: string; tag: string; canaries: string[]; folderId: string }> = [];
    for (const [i, kill] of kills.entries()) {
      const tag = `F${i}${kill.replace(/_/g, "")}`;
      const c = (what: string): string => `CANARY_${tag}_${what}_7e41`;
      const made = await w.owner.call("agents.create", { name: `Desk ${tag}`, role: "You help.", idempotencyKey: `ad-${tag}` });
      assert.equal(made.status, 200, JSON.stringify(made.data));
      const id = made.data.agent.agentId as string;
      const folderId = made.data.agent.folderId as string;
      const canaries = [c("memory"), c("chat"), c("attach"), c("folder"), c("home"), c("routine"), c("agentmd"), c("oldmd"), c("trace")];
      // memory fact
      assert.equal((await w.owner.call("memory.remember", { text: c("memory"), layer: "agent", agentId: id })).status, 200);
      // a file in its Files folder, an attachment in its one-to-one chat
      const file = await w.owner.call("files.create", { folderId, name: "notes.txt", content: { text: c("folder") } });
      assert.equal(file.status, 200, JSON.stringify(file.data));
      const att = await w.owner.call("files.create", { folderId, name: "att.txt", content: { text: c("attach") } });
      const chat = await w.owner.call("chat.start", { kind: "chat", agentIds: [id] });
      const threadId = chat.data.thread.threadId as string;
      await w.owner.call("chat.post", { threadId, body: c("chat"), attachments: [att.data.file.fileId] });
      // AGENT.md, an older version of it, and a routine
      const got = await w.owner.call("agents.get", { agentId: id });
      const mdId = got.data.agent.agentMdFileId as string | undefined;
      if (mdId) {
        await w.owner.call("files.write", { fileId: mdId, content: { text: `# Desk\n${c("oldmd")}\n` } });
        await w.owner.call("files.write", { fileId: mdId, content: { text: `# Desk\n${c("agentmd")}\n` } });
      }
      assert.equal((await w.owner.call("agents.routine.save", { agentId: id, title: "Morning", cron: "0 9 * * 1-5", prompt: c("routine") })).status, 200);
      // its computer: the command (a tool trace and run record) writes a file in its home
      const got2 = await w.turn(w.owner, `home-${tag}`, [{ cmd: `echo ${c("home")} > ~/home-note.txt; echo ${c("trace")} >/dev/null; ls ~ | head -3` }], id);
      assert.ok(got2[0]?.ok, JSON.stringify(got2));
      agents.push({ id, tag, canaries, folderId });
      // positive control: before the delete the canaries ARE found, in the database and on the container's volume
      const before = scan(w.d.paths.root, canaries);
      assert.ok([...before.values()].flatMap((s) => [...s]).length >= 5, "the scan sees the canaries before the delete");
      const vol = await docker(["run", "--rm", "-v", `vyre-ws-${id}-home:/v`, "busybox:1.36.1", "sh", "-c", `grep -rl ${c("home")} /v | head -1`]);
      assert.match(vol.out, /home-note/, "the canary is on the container's home volume before the delete");
    }

    for (const [i, a] of agents.entries()) {
      const kill = kills[i]!;
      assert.equal((await w.owner.call("agents.delete", { agentId: a.id })).status, 200);
      const pressed = await w.owner.call("agents.delete_for_good", { agentId: a.id });
      assert.equal(pressed.status, 200, JSON.stringify(pressed.data));
      // the kill: the job writes its place after each step, so we wait for the point and stop the daemon there
      if (kill === "mid_steps") report[`${a.tag}.midSteps`] = await spinUntil(w.d.paths.root, a.id, (j) => j.state === "erasing" && j.done >= 3);
      else if (kill === "container_gone")
        // the terminal step has removed the container and both volumes; the files step and the row are still to come
        report[`${a.tag}.containerGone`] = await spinUntil(w.d.paths.root, a.id, (j) => j.state === "erasing" && j.steps.includes("terminal") && !j.steps.includes("files"));
      report[`${a.tag}.killedWith`] = jobRow(w.d.paths.root, a.id);
      await w.restart();
      await waitFor(async () => (jobRow(w.d.paths.root, a.id)?.state === "erased" ? true : null), 120_000);
      assert.equal(await containerOf(a.id), false, "docker ps -a shows no container");
      assert.deepEqual(await volumesOf(a.id), [], "docker volume ls shows no volume");
      const hits = scan(w.d.paths.root, a.canaries);
      report[`${a.tag}.hits`] = Object.fromEntries([...hits].map(([k, v]) => [k, [...v]]));
      assert.deepEqual([...hits].map(([k, v]) => `${k}: ${[...v].join(",")}`), [], "no canary is left in any database, file or blob");
    }
  } finally {
    console.log(JSON.stringify(report, null, 1));
    if (process.env["TMPDIR"]) (await import("node:fs")).writeFileSync(path.join(process.env["TMPDIR"], "agdel-heavy.json"), JSON.stringify(report, null, 1));
    await w.close();
  }
});
