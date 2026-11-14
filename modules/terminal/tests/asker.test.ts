// A person who uses a shared agent without owning it works in a folder of their own in its workspace (owner, 13 Nov 2026, P7 section 10 item 6: "a turn sees only the asker's work folder plus the agent's own
// home"). Unit level, with the module's fakes: who gets a place (the asker who is not the owner), who does not (the owner, the Assistant, an outside agent, a turn for nobody), what the host is asked to
// open, and what the tool layer refuses (another person's folder as a working directory or in a command, a project folder of a project the asker is not on).
import test from "node:test";
import assert from "node:assert/strict";
import {
  askerPlace,
  ensureCommand,
  inOtherFolder,
  namesMirror,
  otherFolders,
  ownersHomeRefs,
  projectsNamed,
  removeCommand,
  SQUATTED,
} from "../asker.ts";
import { handlers } from "../impl.ts";
import { bindHost, bindPlace, bindTeam, burnUid, uidOf } from "../projections.ts";
import type { TermCtx } from "../projections.ts";
import { codeOf, fakeHost, harness, reset } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const AGENT = { kind: "agent" as const, id: "agt_dex" };
let keys = 0;
const idem = (): string => `idem_asker_${++keys}`;

test("a place is a Unix user's folder with a history file, config and cache folders and a private temporary folder of its own", () => {
  const p = askerPlace("usr_ben", 20007);
  assert.equal(p.uid, 20007);
  assert.equal(p.home, "/people/u20007");
  assert.deepEqual(
    [p.env["HOME"], p.env["HISTFILE"], p.env["XDG_CONFIG_HOME"], p.env["XDG_CACHE_HOME"], p.env["TMPDIR"]],
    [p.home, `${p.home}/.bash_history`, `${p.home}/.config`, `${p.home}/.cache`, `${p.home}/.tmp`],
  );
  const ensure = ensureCommand(p).join(" ");
  assert.ok(
    ensure.includes("mkdir -m 700") && ensure.includes(`exit ${SQUATTED}`),
    "made 0700 by the person's own user; a folder of someone else's is refused",
  );
  assert.ok(ensure.includes("Your files are in Files. This is your own home on this computer."), "the first line a person reads");
  assert.deepEqual(removeCommand(p).slice(-1), [p.home]);
});

test("a person's uid is made on first use, the same afterwards, never shared, and a burned one is never used again", () => {
  const hn = harness();
  const db = hn.ctx.db;
  const a = uidOf(db, "usr_ana", 1)!;
  const b = uidOf(db, "usr_ben", 1)!;
  assert.equal(a, 20000);
  assert.equal(b, 20001);
  assert.equal(uidOf(db, "usr_ana", 99), a, "found again");
  burnUid(db, "usr_ana", a);
  assert.equal(uidOf(db, "usr_ana", 100), 20002, "a squatted uid is skipped");
  assert.equal(uidOf(db, "usr_cy", 100), 20003, "and never given to the next person");
});

test("friendly words: another person's folder, the agent's own home, the Files mirror and project folders are found in the plain spelling (the kernel is the wall, not this)", () => {
  assert.deepEqual(otherFolders("cat /people/u20001/x", 20000), ["u20001"]);
  assert.deepEqual(otherFolders("cat /people/u20000/x", 20000), []);
  assert.equal(inOtherFolder("/people/u20005", 20000), true);
  assert.deepEqual(ownersHomeRefs("cat /home/agent/.gitconfig /home/agent/.ssh/id_rsa; ls /home/agent"), [
    ".gitconfig",
    ".ssh",
    "",
  ]);
  assert.deepEqual(ownersHomeRefs("ls /home/agent/projects/p /home/agent/Vyre/x /home/agentx"), []);
  assert.equal(namesMirror("ls ~/Vyre/notes"), true);
  assert.equal(namesMirror("ls ~/VyreX"), false);
  assert.deepEqual(projectsNamed("cd ~/projects/prj_a && ls /home/agent/projects/prj_b/x"), ["prj_a", "prj_b"]);
});

function setup(
  agent: { ownerId?: string; kind?: string; runtime?: string; folderId?: string },
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
  /** A person typing (not an agent's turn): the same agent facts. */
  const person = (id: string): TermCtx => ({
    ...hn.as({ kind: "person", id }),
    call: (async (cap: string) =>
      cap === "agents.get" ? { agent: { agentId: AGENT.id, name: "Dex", ...agent } } : undefined) as never,
  });
  return { hn, host, turn, opens, person };
}

test("a turn for a person who is not the agent's owner opens its shell in their place; the owner, an Assistant's person, an outside agent and a turn for nobody keep the agent's home", async () => {
  const shared = setup({ ownerId: "usr_maya", kind: "agent" });
  await h["terminal.run"]!(shared.turn("usr_ben"), { command: "echo hi", idempotencyKey: idem() });
  assert.match(shared.opens()[0]?.place?.home ?? "", /^\/people\/u2\d{4}$/, "Ben, who does not own Dex");
  assert.equal(shared.opens()[0]?.place?.person, "usr_ben");
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

test("friendly refusals in front of the wall: another person's folder, the agent's own home, the Files mirror and a project the asker is not on, for commands, a working directory and typed keys", async () => {
  const w = setup(
    { ownerId: "usr_maya", kind: "agent", folderId: "fld_dex" },
    (type, id) => !(type === "project" && id === "prj_other") && type !== "folder",
  );
  const ben = w.turn("usr_ben");
  const refused = async (input: Record<string, unknown>): Promise<unknown> => {
    try {
      await h["terminal.run"]!(ben, { idempotencyKey: idem(), ...input });
    } catch (e) {
      return (e as { error?: { details?: { reason?: unknown } } }).error?.details?.reason ?? codeOf(e);
    }
    return "not refused";
  };
  assert.equal(await refused({ command: "pwd", cwd: "/people/u29999", session: "a" }), "other_persons_folder");
  assert.equal(await refused({ command: "cat /people/u29999/notes.txt" }), "other_persons_folder");
  assert.equal(await refused({ command: "cat /home/agent/projects/prj_other/secret.txt" }), "project_folder");
  assert.equal(
    await refused({ command: "ls /home/agent/projects/prj_mine" }),
    "not refused",
    "a project the asker is on",
  );
  assert.equal(await refused({ command: "cat /home/agent/.gitconfig" }), "owners_home");
  assert.equal(await refused({ command: "pwd", cwd: "/home/agent", session: "c" }), "owners_home");
  assert.equal(await refused({ command: "ls ~/Vyre/plans" }), "files_folder");
  // the same words for keys typed into a terminal of the agent's
  const opened = await h["terminal.open"]!(ben, { host: "agent_computer", agentId: AGENT.id, idempotencyKey: idem() });
  let typed: unknown = "not refused";
  try {
    await h["terminal.input"]!(ben, {
      terminalId: opened.terminal.terminalId,
      data: "cat /home/agent/.bash_history\n",
    });
  } catch (e) {
    typed = (e as { error?: { details?: { reason?: unknown } } }).error?.details?.reason;
  }
  assert.equal(typed, "owners_home");
  // the owner is not bound by words
  await h["terminal.run"]!(w.turn("usr_maya"), { command: "echo hi", idempotencyKey: idem() });
});

test("FAIL CLOSED: if the agent's facts cannot be read, a person's turn opens nothing (never the owner's home), and the next call, which can read them, works", async () => {
  reset();
  const hn = harness();
  const host = fakeHost({ "echo hi": { exitCode: 0, output: "hi" } });
  bindHost(host.host);
  bindTeam(() => true);
  bindPlace(async () => ({ team: true, agentComputer: true, runsOn: "agent_computer" }) as never);
  let fail = true;
  const ctx: TermCtx = {
    ...hn.as(AGENT, "usr_ben", "run_1"),
    thread: "thr_chat",
    call: (async (cap: string) => {
      if (cap !== "agents.get") return undefined;
      if (fail) throw new Error("agents.get timed out");
      return { agent: { agentId: AGENT.id, name: "Dex", ownerId: "usr_maya", kind: "agent" } };
    }) as never,
  };
  let first: unknown = "opened";
  try {
    await h["terminal.run"]!(ctx, { command: "echo hi", idempotencyKey: idem() });
  } catch (e) {
    first = (e as { error?: { message?: string } }).error?.message ?? codeOf(e);
  }
  assert.notEqual(first, "opened");
  assert.equal(host.count("open"), 0, "no session was made, in anyone's home");
  fail = false;
  await h["terminal.run"]!(ctx, { command: "echo hi", idempotencyKey: idem() });
  const place = (host.calls.find((c) => c.op === "open")?.args as { place?: { uid: number } }).place;
  assert.ok(place && place.uid >= 20000, "the retry opened it in Ben's own place");
});

test("a person who leaves the Space: unreachable at once, terminals closed, their folder removed only when the Trash time is over, intact if they are back before", async () => {
  const { onPersonLeft, onPersonBack, forgetExpiredPeople } = await import("../handlers/sessions.ts");
  const w = setup({ ownerId: "usr_maya", kind: "agent" });
  await h["terminal.run"]!(w.turn("usr_ben"), { command: "echo hi", idempotencyKey: idem() });
  await h["terminal.run"]!(w.turn("usr_ana"), { command: "echo hi", idempotencyKey: idem() });
  const open = (who: string): number =>
    (w.hn.rows("SELECT * FROM terminal_sessions WHERE owner = ? AND closed_at IS NULL", who) as unknown[]).length;
  assert.equal(open("usr_ben"), 1);
  const stopped: string[] = [];
  await onPersonLeft(w.hn.ctx, { payload: { personId: "usr_ben" } }, async (agentId, place) => {
    stopped.push(`${agentId}:${place.uid}`);
  });
  assert.equal(stopped.length, 1, "what they have running is stopped where it runs");
  assert.equal(open("usr_ben"), 0, "their terminals closed");
  let gone: unknown = "opened";
  try {
    await h["terminal.run"]!(w.turn("usr_ben"), { command: "echo hi", idempotencyKey: idem() });
  } catch (e) {
    gone = (e as { error?: { details?: { reason?: unknown } } }).error?.details?.reason;
  }
  assert.equal(gone, "person_gone", "no turn can enter their folder");
  await h["terminal.run"]!(w.turn("usr_ana"), { command: "echo hi", idempotencyKey: idem() });
  const removed: string[] = [];
  let asleep = true;
  const remove = async (agentId: string, place: { home: string }): Promise<boolean> => {
    if (asleep) return false;
    removed.push(`${agentId}:${place.home}`);
    return true;
  };
  // inside the Trash time: nothing is removed
  assert.deepEqual(await forgetExpiredPeople(w.hn.ctx, remove), []);
  // after it, with the workspace asleep: nothing is removed and nothing is woken; the row waits
  w.hn.advance(31 * 86_400_000);
  assert.deepEqual(await forgetExpiredPeople(w.hn.ctx, remove), []);
  assert.deepEqual(removed, []);
  // the workspace is awake at a later pass: it goes, and only theirs
  asleep = false;
  assert.deepEqual(await forgetExpiredPeople(w.hn.ctx, remove), ["usr_ben"]);
  assert.equal(removed.length, 1);
  assert.match(removed[0]!, /^agt_dex:\/people\/u2\d{4}$/);
  // a person who is back inside the time keeps everything
  await onPersonLeft(w.hn.ctx, { payload: { personId: "usr_ana" } }, async () => undefined);
  assert.equal(onPersonBack(w.hn.ctx, { payload: { personId: "usr_ana" } }), true);
  w.hn.advance(40 * 86_400_000);
  assert.deepEqual(await forgetExpiredPeople(w.hn.ctx, remove), []);
  assert.equal(removed.length, 1, "Ana's folder was not removed");
  // an agent is not a person who left
  assert.deepEqual(await onPersonLeft(w.hn.ctx, { payload: { personId: "agt_x" } }, async () => undefined), []);
});

test("F30: a terminal in a person's own place takes keys, commands, Ctrl-C and the keyboard from that person (or an agent acting for them) alone: not the owner, not an admin, not another person's agent, not even under a hold", async () => {
  const w = setup({ ownerId: "usr_maya", kind: "agent" });
  // Ben's agent turn opens his session in his own place
  const ran = await h["terminal.run"]!(w.turn("usr_ben"), { command: "echo hi", idempotencyKey: idem() });
  const id = ran.terminalId as string;
  const reason = async (f: () => unknown): Promise<unknown> => {
    try {
      await f();
    } catch (e) {
      return (e as { error?: { details?: { reason?: unknown } } }).error?.details?.reason ?? codeOf(e);
    }
    return "allowed";
  };
  const maya = w.person("usr_maya"); // the agent's owner, who manages it
  const ana = w.turn("usr_ana"); // another person's turn of the same agent
  const nobody = w.turn(undefined); // a turn for nobody
  for (const [who, ctx] of [
    ["the agent's owner typing", maya],
    ["another person's agent", ana],
    ["a turn for nobody", nobody],
  ] as const) {
    assert.equal(await reason(() => h["terminal.input"]!(ctx, { terminalId: id, data: "ls\n" })), "others_place", `${who}: keys`);
    assert.equal(await reason(() => h["terminal.interrupt"]!(ctx, { terminalId: id })), "others_place", `${who}: Ctrl-C`);
    assert.equal(
      await reason(() => h["terminal.run"]!(ctx, { command: "echo hi", terminalId: id, idempotencyKey: idem() })),
      "others_place",
      `${who}: a command in that session`,
    );
  }
  assert.equal(await reason(() => h["terminal.take_over"]!(maya, { terminalId: id })), "others_place", "the owner cannot take the keyboard");
  // Ben's own person, and his agent acting for him, are in
  assert.equal(await reason(() => h["terminal.input"]!(w.person("usr_ben"), { terminalId: id, data: "ls\n" })), "allowed");
  assert.equal(await reason(() => h["terminal.input"]!(w.turn("usr_ben"), { terminalId: id, data: "ls\n" })), "allowed");
  // Ben takes the keyboard of his own terminal: still nobody else types in it
  await h["terminal.take_over"]!(w.person("usr_ben"), { terminalId: id });
  assert.notEqual(await reason(() => h["terminal.input"]!(maya, { terminalId: id, data: "ls\n" })), "allowed");
  assert.equal(await reason(() => h["terminal.input"]!(w.person("usr_ben"), { terminalId: id, data: "ls\n" })), "allowed", "the holder's own keys");
  // the owner's own session (in the agent's own home) is unchanged: the owner types in it
  const mine = await h["terminal.run"]!(w.turn("usr_maya"), { command: "echo hi", idempotencyKey: idem() });
  assert.equal(await reason(() => h["terminal.input"]!(maya, { terminalId: mine.terminalId, data: "ls\n" })), "allowed");
});

test("F30: FAIL CLOSED at every terminal door: if the agent's facts cannot be read, keys, Ctrl-C and commands into a session of a person are refused, then work once they can be read", async () => {
  const w = setup({ ownerId: "usr_maya", kind: "agent" });
  const ran = await h["terminal.run"]!(w.turn("usr_ben"), { command: "echo hi", idempotencyKey: idem() });
  let fail = true;
  const broken = (ctx: TermCtx): TermCtx => ({
    ...ctx,
    call: (async (cap: string) => {
      if (fail) throw new Error("agents.get timed out");
      return (ctx.call as (c: string, i: unknown) => Promise<unknown>)(cap, {});
    }) as never,
  });
  const ben = broken(w.person("usr_ben"));
  let r1: unknown = "allowed";
  try {
    await h["terminal.input"]!(ben, { terminalId: ran.terminalId, data: "ls\n" });
  } catch {
    r1 = "refused";
  }
  assert.equal(r1, "refused");
  fail = false;
  await h["terminal.input"]!(ben, { terminalId: ran.terminalId, data: "ls\n" });
});

test("F30: a turn in a person's own place cannot set the variables that point the shell elsewhere", async () => {
  const w = setup({ ownerId: "usr_maya", kind: "agent" });
  for (const k of ["HOME", "HISTFILE", "XDG_CONFIG_HOME", "TMUX_TMPDIR", "GIT_SSH_COMMAND", "SSH_AUTH_SOCK", "PATH"]) {
    let r: unknown = "allowed";
    try {
      await h["terminal.run"]!(w.turn("usr_ben"), { command: "echo hi", env: { [k]: "/home/agent" }, idempotencyKey: idem() });
    } catch (e) {
      r = (e as { error?: { details?: { reason?: unknown } } }).error?.details?.reason ?? codeOf(e);
    }
    assert.equal(r, "place_env", k);
  }
  // an ordinary variable is fine, and the owner is not bound
  await h["terminal.run"]!(w.turn("usr_ben"), { command: "echo hi", env: { MODE: "x" }, idempotencyKey: idem() });
  await h["terminal.run"]!(w.turn("usr_maya"), { command: "echo hi", env: { HOME: "/home/agent" }, idempotencyKey: idem() });
});
