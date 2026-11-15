// @heavy docker
// Round two of the wall (review of 15 Nov 2026, items 1 to 6): what the first walk did not try, on a booted daemon with a real workspace container.
//   1  the agent's home is not walkable by a guest: files made with a loose umask (an older workspace, an exec outside the session shell) are refused
//   2  a person's programs end and their terminals close whenever Use is lost, by any path: a group, an expiring share, a share taken away
//   3  nobody can make another person's /tmp/tmux-<uid> or /people/u<uid> folder first, a uid is never remapped, /people cannot be listed
//   4  a person who left a chat has no access to its shared folder
//   5  a person with no access to the agent is told nothing of its terminals and gets a plain sentence
//   6  the events of a terminal on an agent's computer are not read by the people who only use the agent
// Ada is the world's owner, Bea is Ana, Ben is Ben.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { world } from "./support/agentpc-world.ts";
import type { World } from "./support/agentpc-world.ts";
import { hostLog, waitFor } from "./support/eco-live.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON
  ? false
  : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (the workspace is a real container)";
const KERNEL = /Permission denied|Operation not permitted/;
const docker = (args: string[]): Promise<{ out: string }> =>
  new Promise((resolve) => {
    execFile("docker", args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (_e, stdout, stderr) =>
      resolve({ out: `${stdout}\n${stderr}` }),
    );
  });
const H = 'H=/home/ag""ent;'; // a path the friendly check in front of the tool cannot spell out: the wall is the kernel
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Ada's agent is shared by name only: the Space-wide share it is born with is taken away. */
async function private_(w: World): Promise<void> {
  const born = await w.owner.call("access.grants.list", { resource: { type: "agent", id: w.agent } });
  assert.equal(born.status, 200, JSON.stringify(born.data));
  for (const g of born.data.grants as Array<{ id: string; subject: { kind: string } }>)
    if (g.subject.kind === "group") assert.equal((await w.owner.call("access.unshare", { grantId: g.id })).status, 200);
}
const shareUse = async (w: World, subject: Record<string, unknown>, conditions?: Record<string, unknown>) => {
  const r = await w.owner.call("access.share", {
    resource: { type: "agent", id: w.agent },
    subject,
    level: "use",
    ...(conditions ? { conditions } : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.grant.id as string;
};

test(
  "1 the agent's home is not walkable by a guest: files written with a loose umask are refused (an older workspace, an exec outside the session shell)",
  { skip, timeout: 900_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    await private_(w);
    await shareUse(w, { kind: "person", id: w.ana.id });
    const ws = `vyre-ws-${w.agent}`;
    // Ada's turn makes the workspace; then her own user writes the way an engine or a docker exec does, umask 022
    const first = await w.turn(w.owner, "w2-1a", [{ cmd: "echo ready" }]);
    assert.equal(first[0]!.text, "ready");
    const loose = await docker([
      "exec",
      "--user",
      "10001:10001",
      ws,
      "sh",
      "-c",
      "umask 022; echo NPMRC-SECRET > /home/agent/.npmrc; mkdir -p /home/agent/work; echo NOTES-SECRET > /home/agent/work/notes.txt; ls -l /home/agent/.npmrc",
    ]);
    assert.match(loose.out, /-rw-r--r--/, "the file is world-readable as written");
    // Bea's first command makes her place and the grant; the strip comes with it
    const probe = async (key: string) =>
      w.turn(w.ana, key, [
        { cmd: `${H} cat $H/.npmrc 2>&1` },
        { cmd: `${H} cat $H/work/notes.txt 2>&1` },
        { cmd: `${H} ls $H/work 2>&1` },
      ]);
    const got = await probe("w2-1b");
    for (const [i, what] of ["the .npmrc", "a file in a folder", "the folder"].entries()) {
      assert.doesNotMatch(got[i]!.text, /SECRET/, `${what} printed`);
      assert.match(got[i]!.text, KERNEL, `${what}: ${got[i]!.text}`);
    }
    // a file written after her grant is stripped at her next grant, within the grant's few seconds
    await docker([
      "exec",
      "--user",
      "10001:10001",
      ws,
      "sh",
      "-c",
      "umask 022; echo LATE-SECRET > /home/agent/late.txt",
    ]);
    await sleep(6500);
    const again = await w.turn(w.ana, "w2-1c", [{ cmd: `${H} cat $H/late.txt 2>&1` }]);
    assert.doesNotMatch(again[0]!.text, /SECRET/);
    assert.match(again[0]!.text, KERNEL, again[0]!.text);
    // Ada, the owner, still reads her own files
    const mine = await w.turn(w.owner, "w2-1d", [{ cmd: "cat ~/.npmrc ~/work/notes.txt ~/late.txt" }]);
    assert.match(mine[0]!.text, /NPMRC-SECRET[\s\S]*NOTES-SECRET[\s\S]*LATE-SECRET/);
  },
);

test(
  "2 a person's programs end and their terminals close whenever Use is lost: through a group, by an expiring share, by taking the share away",
  { skip, timeout: 1_200_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    await private_(w);
    const ws = `vyre-ws-${w.agent}`;
    // Bea has Use through a group; Ben through a share that runs out
    const group = await w.owner.call("access.groups.create", { name: "Helpers", idempotencyKey: "w2-grp" });
    assert.equal(group.status, 200, JSON.stringify(group.data));
    const groupId = group.data.group.id as string;
    assert.equal(
      (await w.owner.call("access.groups.add_member", { groupId, member: { kind: "person", id: w.ana.id } })).status,
      200,
    );
    await shareUse(w, { kind: "group", id: groupId });
    await shareUse(w, { kind: "person", id: w.ben.id }, { expiresAt: Date.now() + 40_000 });
    const start = async (who: World["ana"], key: string, n: number): Promise<number> => {
      const r = await w.turn(who, key, [{ cmd: `(sleep ${n} >/dev/null 2>&1 &); id -u` }]);
      return Number(r[0]!.text);
    };
    const beaUid = await start(w.ana, "w2-2a", 7001);
    const benUid = await start(w.ben, "w2-2b", 7002);
    const running = async (uid: number): Promise<string> =>
      (await docker(["exec", ws, "sh", "-c", `pgrep -u ${uid} | wc -l`])).out.trim().split("\n")[0]!;
    assert.notEqual(await running(beaUid), "0", "Bea's programs run");
    assert.notEqual(await running(benUid), "0", "Ben's programs run");
    // the group loses her
    assert.equal(
      (await w.owner.call("access.groups.remove_member", { groupId, member: { kind: "person", id: w.ana.id } })).status,
      200,
    );
    await waitFor(
      async () => {
        await w.d.hooks?.pump?.();
        return (await running(beaUid)) === "0" ? true : null;
      },
      60_000,
      () => hostLog(w.d),
    );
    // Ben's share runs out: the sweep ends his programs without any event
    await waitFor(
      async () => {
        await w.d.hooks?.pump?.();
        return (await running(benUid)) === "0" ? true : null;
      },
      120_000,
      () => hostLog(w.d),
    );
    const after = await w.turn(w.ana, "w2-2c", [{ cmd: "echo STILL" }]).catch((e: unknown) => String(e));
    assert.doesNotMatch(JSON.stringify(after), /STILL/, "Bea's next command is refused");
  },
);

test(
  "3 nobody makes another person's folder first: /people is not listable or writable by a guest, a uid stays the person's, tmux sockets are in the person's own folder",
  { skip, timeout: 900_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    await private_(w);
    await shareUse(w, { kind: "person", id: w.ana.id });
    await shareUse(w, { kind: "person", id: w.ben.id });
    const ws = `vyre-ws-${w.agent}`;
    // Bea first: she is u20000. She tries to make Ben's folder (u20001) and his tmux folder before he arrives
    const squat = await w.turn(w.ana, "w2-3a", [
      { cmd: "id -u" },
      { cmd: 'P=/peo""ple; mkdir $P/u20001 2>&1; echo END' },
      { cmd: "mkdir -m 777 /tmp/tmux-20001 2>&1; echo END" },
      { cmd: "ls /people 2>&1; echo END" },
    ]);
    assert.equal(squat[0]!.text, "20000");
    assert.match(
      squat[1]!.text,
      /exists|denied|not permitted/i,
      "Ben's folder cannot be made: it is there, and not hers",
    );
    assert.match(squat[3]!.text, KERNEL, "/people cannot be listed by a guest");
    // Ben arrives: his uid is the next one, never another, and his terminal works
    const ben = await w.turn(w.ben, "w2-3b", [{ cmd: "id -u; echo $TMUX_TMPDIR" }, { cmd: "echo hello" }]);
    assert.equal(ben[0]!.text.split("\n")[0], "20001", ben[0]!.text);
    assert.match(ben[0]!.text, /\/people\/u20001\/\.tmux/, "his tmux keeps its socket in his own folder");
    assert.equal(ben[1]!.text, "hello", ben[1]!.text);
    const owned = await docker(["exec", ws, "stat", "-c", "%u", "/people/u20001"]);
    assert.equal(owned.out.trim().split("\n")[0], "20001", "his folder is his, made for his uid by the image");
    const sock = await docker(["exec", "--user", "20001:20001", ws, "sh", "-c", "ls /people/u20001/.tmux"]);
    assert.match(sock.out, /tmux-20001/, "his tmux server is in his own folder");
  },
);

/** Ada's private agent shared with Bea, a channel of the two and the agent, and what each has made in it. */
async function chatWorld(t: { after(f: () => unknown): void }) {
  const w = await world();
  t.after(() => w.close());
  await private_(w);
  const grant = await shareUse(w, { kind: "person", id: w.ana.id });
  const ws = `vyre-ws-${w.agent}`;
  const ch = await w.owner.call("channels.create", {
    name: "pair",
    visibility: "invite",
    memberIds: [w.ana.id],
    agentIds: [w.agent],
  });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const channelId = ch.data.channel.channelId as string;
  const threadId = ch.data.channel.mainThreadId as string;
  const say = async (who: World["owner"], key: string, steps: unknown[]) => {
    await who.call("threads.set_mode", { threadId, mode: "auto" });
    const posted = await who.call("chat.post", {
      threadId,
      body: `RUN ${key} ${JSON.stringify(steps)}`,
      mentions: [{ kind: "agent", id: w.agent }],
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    return w.waitFor(key);
  };
  await say(w.owner, "w2-4a", [{ cmd: "echo BEFORE > ~/chat/before.txt; echo ok" }]);
  const b = await say(w.ana, "w2-4b", [{ cmd: "cat ~/chat/before.txt; echo BEA > ~/chat/bea.txt; id -u" }]);
  assert.match(b[0]!.text, /BEFORE/, "Bea reads the chat's folder while she is in the chat");
  const chatDir = (await docker(["exec", ws, "sh", "-c", "ls -d /home/agent/chats/thr_*"])).out.trim().split("\n")[0]!;
  return { w, ws, grant, channelId, say, chatDir };
}

test("4 a person who left a chat has no access to its shared folder", { skip, timeout: 900_000 }, async (t) => {
  const { w, ws, channelId, say, chatDir } = await chatWorld(t);
  const rm = await w.owner.call("channels.members.remove", { channelId, personId: w.ana.id });
  assert.equal(rm.status, 200, JSON.stringify(rm.data));
  await say(w.owner, "w2-4c", [{ cmd: "echo AFTER > ~/chat/after.txt; echo ok" }]);
  const gone = async (): Promise<boolean> => {
    await w.d.hooks?.pump?.();
    const r = await docker([
      "exec",
      "--user",
      "20000:20000",
      ws,
      "sh",
      "-c",
      `cat ${chatDir}/after.txt 2>&1; echo X > ${chatDir}/bea2.txt 2>&1; echo END`,
    ]);
    return KERNEL.test(r.out) && !/AFTER/.test(r.out);
  };
  await waitFor(
    async () => ((await gone()) ? true : null),
    60_000,
    () => hostLog(w.d),
  );
  // Ada still has it
  const mine = await say(w.owner, "w2-4d", [{ cmd: "cat ~/chat/after.txt ~/chat/bea.txt" }]);
  assert.match(mine[0]!.text, /AFTER[\s\S]*BEA/);
});

test(
  "5 a person with no access to the agent is told nothing of its terminals and gets a plain sentence that is not a fault to try again",
  { skip, timeout: 900_000 },
  async (t) => {
    const { w, grant } = await chatWorld(t);
    const adaTerms = (
      (await w.owner.call("terminal.list", {})).data.terminals as Array<{ terminalId: string; elsewhere?: boolean }>
    ).filter((x) => x.elsewhere !== true);
    assert.ok(adaTerms.length > 0);
    assert.equal((await w.owner.call("access.unshare", { grantId: grant })).status, 200);
    const list = await w.ana.call("terminal.list", {});
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.deepEqual(
      (list.data.terminals as Array<{ agentId?: string }>).filter((x) => x.agentId === w.agent),
      [],
      "no row of the agent's computer for a person with no access",
    );
    const get = await w.ana.call("terminal.get", { terminalId: adaTerms[0]!.terminalId });
    assert.equal(get.status, 404, JSON.stringify(get.data));
    const status = await w.ana.call("terminal.status", { terminalIds: [adaTerms[0]!.terminalId] });
    assert.deepEqual(status.data.rows ?? [], [], "nothing of a terminal outside her place");
    const run = await w.ana.call("terminal.run", { agentId: w.agent, command: "echo x", idempotencyKey: "w2-5" });
    assert.notEqual(run.status, 200);
    const e = (run.data as { error?: { message?: string; retryable?: boolean; code?: string } }).error;
    assert.equal(e?.retryable, false, JSON.stringify(run.data));
    assert.doesNotMatch(String(e?.message), /try again|moment/i, "not a fault to try again");
    assert.notEqual(e?.code, "internal.unavailable");
  },
);

test(
  "6 the events of a terminal on an agent's computer are not read by a person who only uses the agent, and a row that says it is there carries nothing else",
  { skip, timeout: 900_000 },
  async (t) => {
    const { w } = await chatWorld(t);
    const rows = (await w.ana.call("terminal.list", {})).data.terminals as Array<Record<string, unknown>>;
    const adaTerms = (
      (await w.owner.call("terminal.list", {})).data.terminals as Array<{ terminalId: string; elsewhere?: boolean }>
    ).filter((x) => x.elsewhere !== true);
    assert.ok(adaTerms.length > 0);
    await w.owner.call("terminal.rename", { terminalId: adaTerms[0]!.terminalId, name: "ADA-RENAMED-SECRET" });
    const ev = await w.ana.call("events.list", {
      types: ["terminal.opened", "terminal.renamed", "terminal.command_finished", "terminal.closed"],
    });
    assert.equal(ev.status, 200, JSON.stringify(ev.data));
    const seen = JSON.stringify(ev.data);
    for (const t0 of adaTerms)
      assert.ok(
        !seen.includes(t0.terminalId),
        `Bea reads an event about Ada's terminal ${t0.terminalId}: ${seen.slice(0, 1200)}`,
      );
    assert.doesNotMatch(seen, /ADA-RENAMED-SECRET/);
    // the row that only says a terminal is there
    for (const t0 of adaTerms) {
      const r = rows.find((x) => x["terminalId"] === t0.terminalId);
      if (r === undefined) continue;
      assert.equal(r["elsewhere"], true);
      assert.equal(r["createdAt"], 0, "no time");
      assert.equal(r["cols"], 0, "no size");
      assert.equal(r["exitCode"], null);
      assert.equal(r["cwd"], "");
      assert.equal(r["threadId"], undefined);
      assert.equal(r["by"], undefined);
    }
    // and nothing of it by status
    const st = await w.ana.call("terminal.status", { terminalIds: adaTerms.map((x) => x.terminalId) });
    assert.deepEqual(st.data.rows, []);
  },
);

test(
  "7 a guest never has search permission on the agent's home: what the agent writes after a grant with a loose umask, by any process, is refused at once, 6 s later and within 5 s of her last command; the owner's paths work",
  { skip, timeout: 900_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    await private_(w);
    await shareUse(w, { kind: "person", id: w.ana.id });
    const proj = await w.owner.call("projects.create", { type: "project", title: "Both" });
    assert.equal(proj.status, 200, JSON.stringify(proj.data));
    const projectId = proj.data.projectId as string;
    for (const principal of [w.agent, w.ana.id])
      assert.equal((await w.owner.call("projects.members.set", { projectId, principal, role: "member" })).status, 200);
    const ws = `vyre-ws-${w.agent}`;
    const mine = await w.turn(w.owner, "w2-7a", [{ cmd: `echo OWNER-PROJECT > ~/projects/${projectId}/o.txt; echo OWNER-HOME > ~/own.txt; ls -ld ~/projects; echo ok` }]);
    assert.match(mine[0]!.text, /ok$/, mine[0]!.text);
    assert.match(mine[0]!.text, /projects ->/, "~/projects of the owner is a link to the shared folder, and still works");
    // Bea's first command makes her place and her grant
    const first = await w.turn(w.ana, "w2-7b", [{ cmd: `cat ~/projects/${projectId}/o.txt; id -u` }]);
    assert.match(first[0]!.text, /OWNER-PROJECT/, "she reads the project she is on, through her own ~/projects");
    // after the grant: the agent's own user writes with umask 022 (what an engine, an exec outside the session shell, a docker cp does), nested too
    const writes = async (tag: string): Promise<void> => {
      await docker([
        "exec",
        "--user",
        "10001:10001",
        ws,
        "sh",
        "-c",
        `umask 022; echo LATE-${tag} > /home/agent/late-${tag}.txt; mkdir -p /home/agent/latedir-${tag}; echo NESTED-${tag} > /home/agent/latedir-${tag}/x.txt`,
      ]);
    };
    const asBea = async (tag: string): Promise<string> =>
      (
        await docker([
          "exec",
          "--user",
          "20000:20000",
          ws,
          "sh",
          "-c",
          `cat /home/agent/late-${tag}.txt 2>&1; cat /home/agent/latedir-${tag}/x.txt 2>&1; ls /home/agent 2>&1; stat /home/agent/late-${tag}.txt 2>&1; echo END`,
        ])
      ).out;
    const refused = (out: string, what: string): void => {
      assert.doesNotMatch(out, /LATE-|NESTED-/, `${what}: printed ${out.slice(0, 200)}`);
      assert.equal((out.match(/Permission denied/g) ?? []).length >= 3, true, `${what}: ${out}`);
    };
    await writes("a");
    refused(await asBea("a"), "at once");
    await sleep(6500);
    refused(await asBea("a"), "6 s later");
    // inside 5 s of her last command: she types, the agent writes, she reads
    await w.turn(w.ana, "w2-7c", [{ cmd: "echo typing" }]);
    await writes("b");
    refused(await asBea("b"), "within 5 s of her last command");
    // a file made by Vyre's own exec (what an engine's call uses): mode 600; and one written like the Files mirror (a tar with mode 0644)
    const { boundWorkspaces } = await import("../modules/terminal/impl.ts");
    await boundWorkspaces()!.exec(w.agent, ["sh", "-c", "echo VIA-EXEC > /home/agent/via-exec.txt"]);
    const mode = await docker(["exec", ws, "stat", "-c", "%a", "/home/agent/via-exec.txt"]);
    assert.equal(mode.out.trim().split("\n")[0], "600", "an exec of Vyre's runs under umask 077");
    await docker(["exec", "--user", "10001:10001", ws, "sh", "-c", "umask 022; echo MIRROR-LIKE > /home/agent/mirror-like.txt; chmod 644 /home/agent/mirror-like.txt"]);
    const m = await docker(["exec", "--user", "20000:20000", ws, "sh", "-c", "cat /home/agent/mirror-like.txt 2>&1; getfacl -c /home/agent 2>&1 | grep -c u:20000; echo END"]);
    assert.doesNotMatch(m.out, /MIRROR-LIKE/);
    assert.match(m.out, /Permission denied/);
    assert.match(m.out, /\n0\n/, "no entry for a guest on the home at all");
    // the owner reads her own, old and new
    const back = await w.turn(w.owner, "w2-7d", [{ cmd: `cat ~/own.txt ~/late-a.txt ~/latedir-b/x.txt ~/projects/${projectId}/o.txt` }]);
    assert.match(back[0]!.text, /OWNER-HOME[\s\S]*LATE-a[\s\S]*NESTED-b[\s\S]*OWNER-PROJECT/);
  },
);
