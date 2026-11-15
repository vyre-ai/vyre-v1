// A person who uses a shared agent without owning it works in a folder of their own in its workspace (owner, 13 Nov 2026, P7 section 10 item 6: "a turn sees only the asker's work folder plus the agent's own
// home"). Unit level, with the module's fakes: who gets a place (the asker who is not the owner), who does not (the owner, the Assistant, an outside agent, a turn for nobody), what the host is asked to
// open, and what the tool layer refuses (another person's folder as a working directory or in a command, a project folder of a project the asker is not on).
import test from "node:test";
import assert from "node:assert/strict";
import { askerPlace, ensureCommand, folderOf, inOtherFolder, otherFolders, projectsNamed } from "../asker.ts";
import { handlers } from "../impl.ts";
import { bindHost, bindPlace, bindTeam } from "../projections.ts";
import type { TermCtx } from "../projections.ts";
import { codeOf, fakeHost, harness, reset } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const AGENT = { kind: "agent" as const, id: "agt_dex" };
let keys = 0;
const idem = (): string => `idem_asker_${++keys}`;

test("a place is a folder, a history file, config and cache folders and a tmux server of the person's own, all under the agent's home", () => {
  const p = askerPlace("usr_ben");
  assert.equal(p.home, "/home/agent/people/usr_ben");
  assert.deepEqual(
    [p.env["HOME"], p.env["HISTFILE"], p.env["XDG_CONFIG_HOME"], p.env["XDG_CACHE_HOME"], p.env["TMUX_TMPDIR"]],
    [p.home, `${p.home}/.bash_history`, `${p.home}/.config`, `${p.home}/.cache`, "/tmp/vyre-tmux/usr_ben"],
  );
  assert.equal(folderOf("usr_../x y"), "usr____x_y", "nothing a path would carry survives");
  assert.deepEqual(ensureCommand(p).slice(0, 2), ["sh", "-c"]);
});

test("another person's folder is found in a path or a command, in every spelling a shell expands, and not one's own", () => {
  assert.deepEqual(otherFolders("cat /home/agent/people/usr_ana/x", "usr_ben"), ["usr_ana"]);
  assert.deepEqual(otherFolders("ls ~/people/usr_ana && cat $HOME/people/usr_cy/y ${HOME}/people/usr_di", "usr_ben"), [
    "usr_ana",
    "usr_cy",
    "usr_di",
  ]);
  assert.deepEqual(otherFolders("cat /home/agent/people/usr_ben/x", "usr_ben"), []);
  assert.equal(inOtherFolder("~/people/usr_ana", "usr_ben"), true);
  assert.equal(inOtherFolder("/home/agent/people/usr_ben/work", "usr_ben"), false);
  assert.equal(inOtherFolder("/home/agent", "usr_ben"), false);
  assert.deepEqual(projectsNamed("cd ~/projects/prj_a && ls /home/agent/projects/prj_b/x"), ["prj_a", "prj_b"]);
});

function setup(
  agent: { ownerId?: string; kind?: string; runtime?: string },
  allow: (type: string, id: string | null) => boolean = () => true,
) {
  reset();
  const hn = harness({ allow: (_a, r) => allow(r.type, r.id) });
  const host = fakeHost({ pwd: { exitCode: 0, output: "/home/agent" }, "echo hi": { exitCode: 0, output: "hi" } });
  bindHost(host.host);
  bindTeam(() => true);
  bindPlace(async () => ({ team: true, agentComputer: true, runsOn: "agent_computer" }) as never);
  const turn = (asker?: string): TermCtx => ({
    ...hn.as(AGENT, asker, "run_1"),
    thread: "thr_chat",
    call: (async (cap: string) =>
      cap === "agents.get" ? { agent: { agentId: AGENT.id, name: "Dex", ...agent } } : undefined) as never,
  });
  const opens = () =>
    host.calls
      .filter((c) => c.op === "open")
      .map((c) => c.args as { place?: ReturnType<typeof askerPlace>; cwd?: string });
  return { hn, host, turn, opens };
}

test("a turn for a person who is not the agent's owner opens its shell in their place; the owner, an Assistant's person, an outside agent and a turn for nobody keep the agent's home", async () => {
  const shared = setup({ ownerId: "usr_maya", kind: "agent" });
  await h["terminal.run"]!(shared.turn("usr_ben"), { command: "echo hi", idempotencyKey: idem() });
  assert.equal(shared.opens()[0]?.place?.home, "/home/agent/people/usr_ben", "Ben, who does not own Dex");
  await h["terminal.run"]!(shared.turn("usr_maya"), { command: "echo hi", idempotencyKey: idem() });
  assert.equal(shared.opens()[1]?.place, undefined, "Maya owns Dex: the agent's home as it was");
  await h["terminal.run"]!(shared.turn(undefined), { command: "echo hi", idempotencyKey: idem() });
  assert.equal(shared.opens()[2]?.place, undefined, "a turn for nobody");
  for (const [what, facts] of [
    ["an Assistant", { ownerId: "usr_maya", kind: "assistant" }],
    ["an outside agent", { ownerId: "usr_maya", kind: "agent", runtime: "outside" }],
  ] as const) {
    const w = setup(facts);
    await h["terminal.run"]!(w.turn("usr_ben"), { command: "echo hi", idempotencyKey: idem() });
    assert.equal(w.opens()[0]?.place, undefined, what);
  }
});

test("the tool layer refuses another person's folder as a working directory and in a command, and a project folder of a project the asker is not on", async () => {
  const w = setup({ ownerId: "usr_maya", kind: "agent" }, (type, id) => !(type === "project" && id === "prj_other"));
  const ben = w.turn("usr_ben");
  const refused = async (input: Record<string, unknown>): Promise<unknown> => {
    try {
      await h["terminal.run"]!(ben, { idempotencyKey: idem(), ...input });
    } catch (e) {
      return (e as { error?: { details?: { reason?: unknown } } }).error?.details?.reason ?? codeOf(e);
    }
    return "not refused";
  };
  assert.equal(
    await refused({ command: "pwd", cwd: "/home/agent/people/usr_ana", session: "a" }),
    "other_persons_folder",
  );
  assert.equal(await refused({ command: "cat ~/people/usr_ana/notes.txt" }), "other_persons_folder");
  assert.equal(await refused({ command: "cat /home/agent/projects/prj_other/secret.txt" }), "project_folder");
  assert.equal(await refused({ command: "pwd", cwd: "/home/agent/people/usr_ben/work", session: "b" }), "not refused");
  assert.equal(
    await refused({ command: "ls /home/agent/projects/prj_mine" }),
    "not refused",
    "a project the asker is on",
  );
  // a person's own tab and the owner are not bound by the text of a command
  const maya = w.turn("usr_maya");
  await h["terminal.run"]!(maya, { command: "echo hi", idempotencyKey: idem() });
});
