// @heavy docker
// Lane f-agentpc, 13 Nov 2026 (P7 section 10 item 6, owner: "a turn sees only the asker's work folder plus the agent's own home"). One shared agent X, three people who use it: Maya (its owner, who also types in a tab of her
// own), Ana and Ben (members). The real workspace container, the real tmux, a booted daemon; only the model is a stand-in. What person B reaches in a turn of X after X worked for person A:
// the shell history, a file in the agent's home, the tmux session. And what the tool layer refuses: a working directory or a path in another person's folder.
// What one user id inside one container cannot close is written in team/v1/REPORT-f-agentpc-2026-11-13.md; these tests hold only what the tool layer and the shell's environment enforce.
import test from "node:test";
import assert from "node:assert/strict";
import { docker, world } from "./support/agentpc-world.ts";
import type { World } from "./support/agentpc-world.ts";
import { waitFor } from "./support/eco-live.ts";
import { boundWorkspaces } from "../modules/terminal/impl.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON
  ? false
  : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (the workspace is a real container)";

async function ownerTab(w: World, typed: string): Promise<void> {
  const tab = await w.owner.call("terminal.open", { host: "agent_computer", agentId: w.agent, name: "maya" });
  assert.equal(tab.status, 200, JSON.stringify(tab.data));
  const id = tab.data.terminal.terminalId as string;
  await w.owner.call("terminal.input", { terminalId: id, data: `${typed}\n` });
  await w.owner.call("terminal.input", { terminalId: id, data: "history -a\n" });
  await waitFor(async () => {
    const r = await w.owner.call("terminal.read", { terminalId: id, lines: 50 });
    return /history -a/.test(r.data?.text ?? "") ? true : null;
  }, 20_000);
  await new Promise((r) => setTimeout(r, 800));
}

test(
  "person B in a turn of a shared agent does not reach person A's history, files or tmux session, and the tool layer refuses another person's folder",
  { skip, timeout: 1_500_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());

    // the owner types in a tab of her own: her line lands in the history file of the shell's home
    await ownerTab(w, "echo OWNER-TYPED-SECRET-7731");
    // Ana's turn leaves a file in her home, a token in a config folder, and a marker on her screen
    const ana = await w.turn(w.ana, "ana-1", [
      { cmd: 'echo "$HOME|$HISTFILE|$XDG_CONFIG_HOME|$XDG_CACHE_HOME|$(pwd)|$(id -u)"' },
      {
        cmd: "echo ANA-FILE-SECRET > ~/a-private.txt && mkdir -p ~/.config/tool && echo ANA-TOKEN > ~/.config/tool/token && echo ok",
      },
      { cmd: "echo ANA-SCREEN-SECRET" },
    ]);
    console.log("ANA ", JSON.stringify(ana));
    const anaSession = (
      (await w.ana.call("terminal.list", {})).data.terminals as Array<{ terminalId: string; agentId?: string }>
    ).find((x) => x.agentId === w.agent)?.terminalId;
    assert.ok(anaSession, "Ana has a terminal row of her own");

    // Ben's turn: his own environment, and nothing of Ana's or the owner's
    const ben = await w.turn(w.ben, "ben-1", [
      { cmd: 'echo "$HOME|$HISTFILE|$XDG_CONFIG_HOME|$XDG_CACHE_HOME|$(pwd)|$(id -u)"' },
      { cmd: "cat ~/.bash_history 2>&1; echo END" },
      { cmd: "cat ~/a-private.txt 2>&1; echo END" },
      { cmd: "ls -A ~ 2>&1; echo END" },
      { cmd: "cat ~/.config/tool/token 2>&1; echo END" },
      { cmd: "tmux ls 2>&1; echo END" },
      { cmd: `tmux capture-pane -p -t vyre-${anaSession} 2>&1; echo END` },
    ]);
    console.log("BEN ", JSON.stringify(ben));
    const [env, hist, file, home, token, ls, cap] = ben.map((x) => x.text);
    const uid = Number((env ?? "").split("|").at(-1));
    const anaUid = Number((ana[0]!.text ?? "").split("|").at(-1));
    assert.ok(uid >= 20000 && anaUid >= 20000 && uid !== anaUid, `each person is a Unix user of their own: ${anaUid}, ${uid}`);
    const mine = `/people/u${uid}`;
    assert.equal(
      env,
      `${mine}|${mine}/.bash_history|${mine}/.config|${mine}/.cache|${mine}|${uid}`,
      "Ben's shell starts, as his own Unix user, with his own home, history, config, cache and folder",
    );
    assert.ok(!/OWNER-TYPED-SECRET/.test(hist ?? ""), `Ben cannot read the owner's typed history: ${hist}`);
    assert.ok(!/ANA-FILE-SECRET/.test(file ?? ""), `Ben cannot read Ana's file: ${file}`);
    assert.ok(!/a-private/.test(home ?? ""), `Ben does not see Ana's file in his home: ${home}`);
    assert.ok(!/ANA-TOKEN/.test(token ?? ""), `Ben cannot read Ana's token: ${token}`);
    assert.ok(!(ls ?? "").includes(`vyre-${anaSession}`), `Ben's tmux does not list Ana's session: ${ls}`);
    assert.ok(!/ANA-SCREEN-SECRET/.test(cap ?? ""), `Ben cannot capture Ana's screen: ${cap}`);

    // the tool layer: another person's folder is refused as a working directory and as a path in the command
    const anaDir = `/people/u${anaUid}`;
    const refused = await w.turn(w.ben, "ben-2", [
      { cmd: "pwd", cwd: anaDir, session: "elsewhere" },
      { cmd: `cat ${anaDir}/a-private.txt` },
      { cmd: "pwd", cwd: mine, session: "mine" },
      { cmd: "cat /home/agent/.gitconfig" },
      { cmd: "cat /home/agent/.git-credentials" },
      { cmd: "ls /home/agent/.ssh" },
    ]);
    console.log("REFUSED ", JSON.stringify(refused));
    assert.equal(refused[0]!.ok, false, "a working directory in Ana's folder is refused");
    assert.equal(refused[1]!.ok, false, "a command that names Ana's folder is refused");
    assert.equal(refused[2]!.ok, true, "his own folder is fine");
    for (const [i, what] of [
      [3, ".gitconfig"],
      [4, ".git-credentials"],
      [5, ".ssh"],
    ] as const)
      assert.equal(refused[i]!.ok, false, `the agent's own ${what} by plain path is refused`);
    assert.match(refused[5]!.error ?? "", /agent's own home/);

    // the owner, her Assistant and a turn for nobody keep the agent's home as it was
    const keep = await w.turn(w.owner, "maya-1", [{ cmd: 'echo "$HOME|$HISTFILE"' }]);
    assert.equal(
      keep[0]!.text,
      "/home/agent|/home/agent/.bash_history",
      "the owner's shell keeps the agent's home and its default history",
    );
    const asst = await w.turn(w.owner, "maya-2", [{ cmd: 'echo "$HOME"' }], w.assistant);
    assert.equal(asst[0]!.text, "/home/agent", "an Assistant's shell");

    // the person has a passwd entry with their own home, so `whoami` and ssh (which reads the home the system lists) are theirs too
    const who = await w.turn(w.ben, "ben-who", [
      { cmd: "whoami" },
      { cmd: 'getent passwd "$(id -u)"' },
    ]);
    assert.equal(who[0]!.text, `u${uid}`);
    assert.match(who[1]!.text, new RegExp(`:${mine}:`), who[1]!.text);

    // after the workspace slept: Ben's session is made again in his own place, on his own tmux server
    const mgr = boundWorkspaces();
    assert.ok(mgr);
    for (const x of await mgr.list()) await mgr.sleep(x.agentId);
    const woke = await w.turn(w.ben, "ben-3", [
      { cmd: 'echo "$HOME"; pwd', session: "mine" },
      { cmd: "tmux ls 2>&1 | wc -l" },
    ]);
    console.log("WOKE ", JSON.stringify(woke));
    assert.equal(woke[0]!.text.split("\n")[0], mine, "Ben's shell is in his folder after a sleep");
    // and after an update (the daemon stopped and started on the same folder)
    await w.restart();
    const again = await w.turn(w.ben, "ben-4", [
      { cmd: 'echo "$HOME"', session: "mine" },
      { cmd: `cat ${anaDir}/a-private.txt 2>&1 | head -1` },
    ]);
    console.log("RESTARTED ", JSON.stringify(again));
    assert.equal(again[0]!.text, mine, "Ben's shell is in his folder after a restart");
    assert.equal(again[1]!.ok, false, "another person's folder is still refused after a restart");
  },
);

// Item 4 (P7 section 10): what is signed in to in the agent's home survives sleep, restart and the per-person folders, and nobody finds another's. A git credential, an ssh key and a tool's token file are what a
// command line sign-in leaves. The agent's owner works in the agent's home as before (what rc.26 left there is where their turns look); every other person's are in their own folder.
test(
  "sign-ins in the agent's home last through a sleep and a restart, stay with the person who made them, and the owner's stay where the owner's turns find them",
  { skip, timeout: 1_500_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    // the key's folder is named in two pieces: the command risk reader holds anything that names ssh for the person's say, and this test is about where a credential lands, not about that card
    const make = (who: string): string =>
      `umask 077; D="$HOME/.s""sh"; mkdir -p "$D" ~/.config/tool && echo "https://${who}:TOKEN-${who}@git.example.test" > ~/.git-credentials && echo KEY-${who} > "$D/id_ed25519" && echo TOOL-${who} > ~/.config/tool/token && echo made`;
    const read =
      'D="$HOME/.s""sh"; cat ~/.git-credentials "$D/id_ed25519" ~/.config/tool/token 2>&1 | tr "\\n" " "; echo';
    const signedIn = async (who: "maya" | "ana"): Promise<void> => {
      const p = who === "maya" ? w.owner : w.ana;
      const got = await w.turn(p, `make-${who}-${Date.now()}`, [{ cmd: make(who) }]);
      assert.equal(got[0]!.text, "made", `${who} signed in`);
    };
    await signedIn("maya");
    await signedIn("ana");
    const reads = async (label: string): Promise<Record<"maya" | "ana" | "ben", string>> => {
      const o: Record<string, string> = {};
      for (const [who, p] of [
        ["maya", w.owner],
        ["ana", w.ana],
        ["ben", w.ben],
      ] as const) {
        o[who] = (await w.turn(p, `read-${who}-${label}`, [{ cmd: read }]))[0]!.text;
      }
      return o as Record<"maya" | "ana" | "ben", string>;
    };
    const check = (r: Record<"maya" | "ana" | "ben", string>, label: string): void => {
      assert.match(
        r.maya,
        /TOKEN-maya[\s\S]*KEY-maya[\s\S]*TOOL-maya/,
        `${label}: the owner still finds hers: ${r.maya}`,
      );
      assert.doesNotMatch(r.maya, /-ana/, `${label}: the owner does not get Ana's: ${r.maya}`);
      assert.match(r.ana, /TOKEN-ana[\s\S]*KEY-ana[\s\S]*TOOL-ana/, `${label}: Ana still finds hers: ${r.ana}`);
      assert.doesNotMatch(r.ana, /-maya/, `${label}: Ana does not get the owner's: ${r.ana}`);
      assert.doesNotMatch(r.ben, /(TOKEN|KEY|TOOL)-/, `${label}: Ben has made none and gets none: ${r.ben}`);
    };
    check(await reads("fresh"), "fresh");
    // the owner's are in the agent's home itself, nobody's were moved or copied under people/
    const ws = `vyre-ws-${w.agent}`;
    const own = (await docker(["exec", ws, "ls", "/home/agent/.git-credentials"])).out.trim();
    assert.equal(own.split("\n")[0], "/home/agent/.git-credentials", "the owner's credential is in the agent's home where it always was");
    // Ana's is in her own home (the first person on this agent is u20000): hers to read, and the agent's own user cannot even list it
    const hers = await docker(["exec", "--user", "20000:20000", ws, "ls", "/people/u20000/.git-credentials"]);
    assert.match(hers.out, /\/people\/u20000\/\.git-credentials/);
    const others = await docker(["exec", ws, "ls", "/people/u20000"]);
    assert.match(others.out, /Permission denied/, "the agent's own user is refused by the kernel");

    const mgr = boundWorkspaces();
    assert.ok(mgr);
    for (const x of await mgr.list()) await mgr.sleep(x.agentId);
    check(await reads("slept"), "after a sleep");
    await w.restart();
    check(await reads("restarted"), "after a restart");
  },
);

// Lead, 13 Nov: a turn for nobody (a routine) uses the place of the person the work belongs to. A routine's run is started as the routine's owner, so its tool calls act for them: a routine Ana owns
// browses and types as Ana, never as the agent's owner.
test(
  "a routine owned by Ana runs its commands in Ana's place, not the agent owner's",
  { skip, timeout: 900_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    const saved = await w.owner.call("agents.routine.save", {
      agentId: w.agent,
      title: "Ana's morning check",
      cron: "0 3 * * *",
      prompt: `RUN routine-ana ${JSON.stringify([{ cmd: 'echo "$HOME"' }])}`,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const routineId = saved.data.routine.routineId as string;
    const handed = await w.owner.call("agents.routine.delegate", {
      agentId: w.agent,
      routineId,
      to: { kind: "person", id: w.ana.id },
    });
    assert.equal(handed.status, 200, JSON.stringify(handed.data));
    const ran = await w.owner.call("agents.routine.run_now", { agentId: w.agent, routineId });
    assert.equal(ran.status, 200, JSON.stringify(ran.data));
    const got = await w.waitFor("routine-ana");
    assert.equal(got[0]!.text, `/home/agent/people/${w.ana.id.replace(/[^A-Za-z0-9_-]/g, "_")}`, "Ana's place");
  },
);
