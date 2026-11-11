// @heavy docker
// A person at an agent's computer (rc.9 flows 12 and 13): a Chrome download reaches Files whole, the live view ticket opens, the person takes the wheel, clicks, and gives it back with the time recorded in the agent's steps.
// One of three tests that replace computers.live.test.ts, split by behaviour. Runs only with VYRE_HEAVY_DOCKER=1.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, docker, ensureImage, finish, homeKit, seededDir, skip, wakeComputer } from "./computers.kit.ts";

test("computers live: a Chrome download reaches Files, and a person can take the wheel of a working computer and give it back", { skip }, async () => {
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
    const { HOME, inBox, until, filesIn } = homeKit(d, dir, agentId, box, folderId);

    // a Chrome download lands in downloads/ and reaches Files
    await inBox("mkdir -p /home/agent/srv && head -c 2097152 /dev/urandom > /home/agent/srv/dl.bin");
    await docker(["exec", "-d", "-u", "10001", box, "python3", "-m", "http.server", "8099", "--bind", "127.0.0.1", "--directory", "/home/agent/srv"], 30_000);
    const opened = await call(d, "computers.chrome.open", { computerId, url: "http://127.0.0.1:8099/dl.bin" });
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    await until("dl.bin in downloads on the computer", async () => (await inBox(`test -s ${HOME}/downloads/dl.bin`)).code === 0);
    const dl = await until("dl.bin in the downloads folder of Files", async () => {
      const dir = (await filesIn(folderId)).folders.find((f) => f.name === "downloads");
      return dir ? (await filesIn(dir.folderId)).files.find((f) => f.name === "dl.bin") : null;
    });
    assert.equal(dl.name, "dl.bin");
    const dlRow = (await filesIn((await filesIn(folderId)).folders.find((f) => f.name === "downloads")!.folderId)).files.find((f) => f.name === "dl.bin") as { size?: number } | undefined;
    assert.equal(dlRow?.size, 2097152, "a 2 MB download went through the upload path whole");

    // take the wheel: a live view ticket, then the person's own click reaches the desktop, and giving back returns the controls to the agent with the time recorded in its steps (rc.9 flow 12)
    // the ticket behind the live view of the pane and the live card; a hang fails here, with this message, instead of using up the whole test
    const view = await Promise.race([
      call(d, "computers.stream", { computerId }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("computers.stream did not answer in 15 s: the live view of a working computer cannot open")), 15_000).unref()),
    ]);
    assert.equal(view.status, 200, JSON.stringify(view.data));
    assert.ok(typeof view.data.ticket === "string" && view.data.ticket.length > 0, "a short-lived ticket for the live view");
    assert.ok(view.data.transport === "mjpeg" || view.data.transport === "webrtc", `a transport: ${JSON.stringify(view.data)}`);
    const took = await call(d, "computers.take_over", { computerId });
    assert.equal(took.status, 200, JSON.stringify(took.data));
    assert.equal(took.data.computer.state, "takeover");
    const clicked = await call(d, "computers.screen.click", { computerId, x: 640, y: 400 });
    assert.equal(clicked.status, 200, `the person's click reached the desktop: ${JSON.stringify(clicked.data)}`);
    const gave = await call(d, "computers.give_back", { computerId });
    assert.equal(gave.status, 200, JSON.stringify(gave.data));
    assert.equal(gave.data.computer.state, "working", "the controls are the agent's again");
    const steps = (await call(d, "computers.timeline", { computerId })).data.steps as Array<{ caption: string; by: string }>;
    assert.ok(steps.some((x) => x.by === "person" && /^You took over/.test(x.caption)), `the take-over is a step: ${JSON.stringify(steps).slice(0, 300)}`);
  } finally {
    await finish(d, computerId);
  }
});
