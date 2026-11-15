// @heavy docker
// The shared agent's wall, walked end to end (F30 and F75, rc.29), on a booted daemon with a real workspace container. Ada owns the agent and shares it with Bea at Use; Ben is a third person who is
// shared with it and then unshared. In the world's own names: Ada is the owner (Maya), Bea is Ana.
//   - Ada keeps a file, a shell history line and a running program in the agent's home; Bea's turn is refused all of them by the kernel, whatever the command says
//   - Bea sees Ada's terminals in `terminal.list` only as rows that say they exist, and cannot read or type into them
//   - a project folder both are on is read and written by both
//   - Bea opens her own terminal on the agent's computer and types in it; Ada cannot type in Bea's
//   - Ben is unshared: his next command is refused and his programs are ended
//   - in a chat with both of them and the agent, each asker's turn works as that asker, and what one made in their own folder is not in the other's
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { world } from "./support/agentpc-world.ts";
import { hostLog, waitFor } from "./support/eco-live.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON
  ? false
  : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (the workspace is a real container)";
const KERNEL = /Permission denied|Operation not permitted/;
const docker = (args: string[]): Promise<{ out: string }> =>
  new Promise((resolve) => {
    execFile("docker", args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ out: `${stdout}\n${stderr}${err ? "" : ""}` }),
    );
  });

test(
  "Ada shares her agent with Bea at Use: Bea works in a place of her own, Ada keeps hers, an unshared person is out",
  { skip, timeout: 1_500_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    const ada = w.owner;
    const bea = w.ana;
    const ben = w.ben;
    const ws = `vyre-ws-${w.agent}`;
    // Ada shares the agent with Bea and with Ben at Use, by name: the Space-wide share it was born with is taken away
    const born = await ada.call("access.grants.list", { resource: { type: "agent", id: w.agent } });
    assert.equal(born.status, 200, JSON.stringify(born.data));
    for (const g of born.data.grants as Array<{ id: string; subject: { kind: string } }>)
      if (g.subject.kind === "group") assert.equal((await ada.call("access.unshare", { grantId: g.id })).status, 200);
    const benGrant = await ada.call("access.share", {
      resource: { type: "agent", id: w.agent },
      subject: { kind: "person", id: ben.id },
      level: "use",
    });
    assert.equal(benGrant.status, 200, JSON.stringify(benGrant.data));
    const beaGrant = await ada.call("access.share", {
      resource: { type: "agent", id: w.agent },
      subject: { kind: "person", id: bea.id },
      level: "use",
    });
    assert.equal(beaGrant.status, 200, JSON.stringify(beaGrant.data));
    const H = 'H=/home/ag""ent;'; // a path the friendly check in front of the tool cannot spell out: the wall is the kernel

    // a project folder both are on: both read and write
    const proj = await ada.call("projects.create", { type: "project", title: "Both" });
    assert.equal(proj.status, 200, JSON.stringify(proj.data));
    const projectId = proj.data.projectId as string;
    for (const principal of [w.agent, bea.id]) {
      const set = await ada.call("projects.members.set", { projectId, principal, role: "member" });
      assert.equal(set.status, 200, JSON.stringify(set.data));
    }

    // Ada: a file, a line of shell history, a program with a secret in its environment, and a sign-in file
    const mine = await w.turn(ada, "walk-ada-1", [
      {
        cmd: 'echo ADA-FILE-SECRET > ~/ada.txt; echo "echo ADA-HISTORY-SECRET" >> ~/.bash_history; (ADA_ENV=ADA-ENV-SECRET sleep 4242 >/dev/null 2>&1 &); echo ready',
      },
    ]);
    assert.equal(mine[0]!.text, "ready", JSON.stringify(mine));

    // Bea's turn: every way at Ada's side of the computer is refused by the kernel
    const probes: Array<[string, { cmd: string; typed?: string }]> = [
      ["Ada's file", { cmd: `${H} cat $H/ada.txt 2>&1` }],
      ["Ada's shell history", { cmd: `${H} cat $H/.bash_history 2>&1` }],
      ["Ada's home listed", { cmd: `${H} ls -la $H 2>&1` }],
      [
        "the environment of Ada's program",
        { cmd: "P=$(pgrep -u 10001 -x sleep | head -1); cat /proc/$P/environ 2>&1 | head -c 120; echo END" },
      ],
      ["Ada's tmux socket", { cmd: "tmux -S /tmp/tmux-10001/default ls 2>&1; echo END" }],
      ["Ada's file typed into a terminal", { cmd: "", typed: `${H} cat $H/ada.txt 2>&1` }],
    ];
    const got = await w.turn(
      bea,
      "walk-bea-1",
      probes.map(([, p]) => p),
    );
    probes.forEach(([what], i) => {
      const text = got[i]!.text;
      assert.doesNotMatch(text, /ADA-/, `${what}: printed ${JSON.stringify(text.slice(0, 160))}`);
      assert.match(text, KERNEL, `${what}: no kernel refusal: ${JSON.stringify(text.slice(0, 160))}`);
    });

    // Bea does not see Ada's terminals beyond a row that says they exist
    const adaList = await ada.call("terminal.list", {});
    assert.equal(adaList.status, 200, JSON.stringify(adaList.data));
    type Row = { terminalId: string; name: string; cwd: string; threadId?: string; by?: unknown };
    const adaIds = (adaList.data.terminals as Row[]).filter((x) => x.cwd === "/home/agent").map((x) => x.terminalId);
    assert.ok(adaIds.length > 0, "Ada has a terminal of her own on the computer");
    const beaList = await bea.call("terminal.list", {});
    assert.equal(beaList.status, 200, JSON.stringify(beaList.data));
    for (const id of adaIds) {
      const row = (beaList.data.terminals as Row[]).find((x) => x.terminalId === id);
      if (row === undefined) continue; // no row at all is fine
      assert.equal(row.cwd, "", "a row of Ada's says no folder");
      assert.equal(row.threadId, undefined, "and no chat");
      assert.equal(row.by, undefined, "and not whose tab it is");
      assert.match(row.name, /Someone else's/);
    }
    assert.doesNotMatch(
      JSON.stringify(beaList.data),
      /ADA-|ada\.txt|\.bash_history|\/home\/agent/,
      "no word of Ada's terminals' content",
    );
    for (const id of adaIds) {
      const read = await bea.call("terminal.read", { terminalId: id });
      assert.notEqual(read.status, 200, `Bea reads Ada's terminal ${id}`);
      const type = await bea.call("terminal.input", {
        terminalId: id,
        data: "echo BEA-INTRUDES\n",
        idempotencyKey: `intr-${id}`,
      });
      assert.notEqual(type.status, 200, `Bea types in Ada's terminal ${id}`);
      const hint = await bea.call("terminal.status", { terminalIds: [id] });
      assert.doesNotMatch(
        JSON.stringify(hint.data),
        /lastLine|lastCommand/,
        "a status of Ada's terminal says nothing of what is in it",
      );
    }

    const wrote = await w.turn(ada, "walk-ada-2", [
      { cmd: `echo ADA-SHARED > ~/projects/${projectId}/ada.txt; echo ok` },
    ]);
    assert.equal(wrote[0]!.text, "ok", JSON.stringify(wrote));
    const both = await w.turn(bea, "walk-bea-2", [
      { cmd: `${H} cat $H/projects/${projectId}/ada.txt 2>&1` },
      {
        cmd: `${H} echo BEA-SHARED > $H/projects/${projectId}/bea.txt 2>&1; cat $H/projects/${projectId}/bea.txt 2>&1`,
      },
    ]);
    assert.match(both[0]!.text, /ADA-SHARED/, "Bea reads what Ada put in the project");
    assert.match(both[1]!.text, /BEA-SHARED/, "Bea writes in the project");
    const back = await w.turn(ada, "walk-ada-3", [
      { cmd: `cat ~/projects/${projectId}/bea.txt` },
      { cmd: "cat ~/ada.txt" },
    ]);
    assert.match(back[0]!.text, /BEA-SHARED/, "Ada reads what Bea put in the project");
    assert.equal(back[1]!.text, "ADA-FILE-SECRET", "Ada still has all of hers");

    // Bea opens a terminal of her own on the agent's computer and types in it; Ada cannot type in it
    const opened = await bea.call("terminal.open", {
      host: "agent_computer",
      agentId: w.agent,
      name: "bea",
      idempotencyKey: "bea-open",
    });
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    const beaTerm = opened.data.terminal.terminalId as string;
    const typed = await bea.call("terminal.input", {
      terminalId: beaTerm,
      data: "echo BEA-TYPED-$(id -u)\n",
      idempotencyKey: "bea-type",
    });
    assert.equal(typed.status, 200, JSON.stringify(typed.data));
    const screen = await waitFor(async () => {
      const r = await bea.call("terminal.read", { terminalId: beaTerm });
      return r.status === 200 && /BEA-TYPED-2\d{4}/.test(String(r.data.text ?? "")) ? r : null;
    }, 30_000);
    assert.ok(screen, "Bea types in her own terminal and reads it");
    const adaTypes = await ada.call("terminal.input", {
      terminalId: beaTerm,
      data: "echo ADA-INTRUDES\n",
      idempotencyKey: "ada-type",
    });
    assert.notEqual(adaTypes.status, 200, "Ada cannot type in Bea's terminal");
    const adaReads = await ada.call("terminal.read", { terminalId: beaTerm });
    assert.notEqual(adaReads.status, 200, "Ada cannot read Bea's terminal");

    // Ben works, then is unshared: his next command is refused and his programs end
    const benWork = await w.turn(ben, "walk-ben-1", [{ cmd: "(sleep 5151 >/dev/null 2>&1 &); id -u" }]);
    const benUid = Number(benWork[0]!.text);
    assert.ok(benUid >= 20000, JSON.stringify(benWork));
    const alive = async (): Promise<string> =>
      (await docker(["exec", ws, "sh", "-c", `pgrep -u ${benUid} -x sleep | wc -l`])).out.trim().split("\n")[0]!;
    assert.equal(await alive(), "1", "Ben's program runs");
    const unshared = await ada.call("access.unshare", { grantId: benGrant.data.grant.id });
    assert.equal(unshared.status, 200, JSON.stringify(unshared.data));
    await waitFor(
      async () => {
        await w.d.hooks?.pump?.();
        return (await alive()) === "0" ? true : null;
      },
      60_000,
      () => hostLog(w.d),
    );
    const after = await w.turn(ben, "walk-ben-2", [{ cmd: "echo BEN-STILL-HERE" }]).catch((e: unknown) => String(e));
    assert.doesNotMatch(JSON.stringify(after), /BEN-STILL-HERE/, "Ben's next command is refused");
    // a chat with both of them and the agent: each asker's turn works as that asker, and the chat's own folder (~/chat) holds what both should see
    const ch = await ada.call("channels.create", {
      name: "pair",
      visibility: "invite",
      memberIds: [bea.id],
      agentIds: [w.agent],
    });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    const threadId = ch.data.channel.mainThreadId as string;
    const say = async (who: typeof ada, key: string, steps: unknown[]) => {
      await who.call("threads.set_mode", { threadId, mode: "auto" });
      const posted = await who.call("chat.post", {
        threadId,
        body: `RUN ${key} ${JSON.stringify(steps)}`,
        mentions: [{ kind: "agent", id: w.agent }],
      });
      assert.equal(posted.status, 200, JSON.stringify(posted.data));
      return w.waitFor(key);
    };
    const a1 = await say(ada, "grp-ada-1", [
      { cmd: 'echo "$(id -u)"' },
      { cmd: "echo CHAT-ADA > ~/chat/ada.txt; echo ADA-OWN-FILE > ~/ada-own.txt; echo ok" },
    ]);
    assert.equal(a1[0]!.text, "10001", "Ada's message runs as Ada");
    assert.equal(a1[1]!.text, "ok", JSON.stringify(a1));
    const b1 = await say(bea, "grp-bea-1", [
      { cmd: 'echo "$(id -u)"' },
      { cmd: "cat ~/chat/ada.txt" },
      { cmd: "echo CHAT-BEA > ~/chat/bea.txt; echo BEA-OWN-FILE > ~/bea-own.txt; echo ok" },
      { cmd: `${H} cat $H/ada-own.txt 2>&1` },
    ]);
    assert.match(b1[0]!.text, /^2\d{4}$/, "Bea's message in Ada's chat runs as Bea's own user, not as Ada's");
    // a read that comes back empty on a loaded box (the output of a typed command is read off a screen) is asked again, up to twice; a refusal is never asked again
    const readAgain = async (who: typeof ada, key: string, cmd: string, first: string): Promise<string> => {
      let text = first;
      for (let i = 1; i <= 2 && text === ""; i++) text = (await say(who, `${key}-again${i}`, [{ cmd }]))[0]!.text;
      return text;
    };
    assert.equal(
      await readAgain(bea, "grp-bea-r", "cat ~/chat/ada.txt", b1[1]!.text),
      "CHAT-ADA",
      "Bea reads what Ada left in the chat's folder",
    );
    assert.equal(b1[2]!.text, "ok", JSON.stringify(b1));
    assert.match(b1[3]!.text, KERNEL, "and not what Ada made in her own folder");
    assert.doesNotMatch(b1[3]!.text, /ADA-OWN/);
    const a2 = await say(ada, "grp-ada-2", [
      { cmd: "cat ~/chat/bea.txt" },
      { cmd: 'P=/peo""ple; cat $P/u20000/bea-own.txt 2>&1' },
    ]);
    assert.equal(
      await readAgain(ada, "grp-ada-r", "cat ~/chat/bea.txt", a2[0]!.text),
      "CHAT-BEA",
      "Ada reads what Bea left in the chat's folder",
    );
    assert.match(a2[1]!.text, KERNEL, "and not what Bea made in her own folder");
    assert.doesNotMatch(a2[1]!.text, /BEA-OWN/);
    // Bea, still shared, is untouched
    const beaStill = await w.turn(bea, "walk-bea-3", [{ cmd: "echo BEA-STILL-HERE" }]);
    assert.equal(beaStill[0]!.text, "BEA-STILL-HERE");
  },
);
