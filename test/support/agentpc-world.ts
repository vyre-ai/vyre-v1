// A Space with one shared agent X (made by the owner) that three people use: the owner Maya (types in a tab of her own too), and two members, Ana and Ben. The model vendor is the only stand-in. A turn's
// commands are given in the message ("RUN <key> <json steps>"): the scripted model runs each step as the agent's terminal_run, acting for whoever posted, and records what the tool answered under <key>.
// The workspace is the real container (VYRE_WORKSPACE_TEST_IMAGE). Used by the lane f-agentpc tests (the terminal and browser bounds by asker).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { CODE_ROOT } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import { boot, claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./eco-live.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { as, join } from "./people.ts";
import type { Caller } from "./people.ts";

export interface Step {
  /** The command (terminal_run). */
  cmd: string;
  /** Type this line into a terminal of the agent (terminal_open, terminal_input, terminal_read) instead of running `cmd`: the other way a model drives a shell. */
  typed?: string;
  cwd?: string;
  session?: string;
}
export interface Got {
  ok: boolean;
  text: string;
  error?: string;
}

export const docker = (args: string[]): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    execFile("docker", args, { cwd: CODE_ROOT, timeout: 90_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}` }),
    );
  });
export const workspaceNames = async (): Promise<string[]> =>
  (await docker(["ps", "-a", "--format", "{{.Names}}", "--filter", "name=vyre-ws-"])).out
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.startsWith("vyre-ws-"));

export interface World {
  d: Daemon;
  agent: string;
  assistant: string;
  owner: { id: string; call: Caller };
  ana: { id: string; call: Caller };
  ben: { id: string; call: Caller };
  /** Post `steps` as `who` in a chat of their own with agent X (or `agentId`), wait for the turn to record, and return the answers. */
  turn(who: { id: string; call: Caller }, key: string, steps: Step[], agentId?: string): Promise<Got[]>;
  /** Wait for the answers a script recorded under `key` (a turn started some other way: a routine). */
  waitFor(key: string): Promise<Got[]>;
  /** Stop the daemon and start it again on the same data folder (what an update does); everyone signs in again. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

let keys = 0;
export async function world(): Promise<World> {
  const saved = process.env["VYRE_WORKSPACE_IMAGE"];
  process.env["VYRE_WORKSPACE_IMAGE"] = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
  const before = new Set(await workspaceNames());
  const results = new Map<string, Got[]>();
  const model = scriptedModel(async function* (input, run) {
    // a person's message carries the script in its body; a routine's run carries it in the routine's prompt (the notice)
    const text = `${input.trigger?.body ?? ""}\n${String((input as { notice?: string }).notice ?? "")}`;
    const m = /(?:^|\n)RUN (\S+) (\[.*\])/.exec(text);
    if (!m) return;
    const steps = JSON.parse(m[2]!) as Step[];
    yield* run("tool_search", { query: "terminal run command" });
    const got: Got[] = [];
    let n = 0;
    for (const s of steps) {
      if (s.typed !== undefined) {
        yield* run("tool_search", { query: "terminal open input read" });
        const opened = (yield* run("terminal_open", { name: `typed-${m[1]}-${n}`, idempotencyKey: `${m[1]}-${++n}-o` })) as {
          content: { data?: { terminal?: { terminalId?: string } }; terminal?: { terminalId?: string } };
        };
        const terminalId = (opened.content?.data ?? opened.content)?.terminal?.terminalId as string;
        yield* run("terminal_input", { terminalId, data: `${s.typed}\n`, idempotencyKey: `${m[1]}-${n}-i` });
        await new Promise((r) => setTimeout(r, 1500));
        const read = (yield* run("terminal_read", { terminalId, lines: 60 })) as {
          ok: boolean;
          content: { data?: { text?: string }; text?: string };
        };
        got.push({ ok: read.ok, text: String((read.content?.data ?? read.content)?.text ?? "").trim() });
        continue;
      }
      const r = (yield* run("terminal_run", {
        command: s.cmd,
        ...(s.cwd === undefined ? {} : { cwd: s.cwd }),
        ...(s.session === undefined ? {} : { session: s.session }),
        idempotencyKey: `${m[1]}-${++n}`,
      })) as {
        ok: boolean;
        content: {
          data?: { output?: string; exitCode?: number };
          output?: string;
          exitCode?: number;
          error?: { message?: string; code?: string };
        };
      };
      const d = r.content?.data ?? r.content ?? {};
      got.push({
        ok: r.ok && ((d as { exitCode?: number }).exitCode ?? 0) === 0,
        text: String((d as { output?: string }).output ?? "").trim(),
        ...(r.ok ? {} : { error: JSON.stringify(r.content).slice(0, 400) }),
      });
    }
    results.set(m[1]!, got);
  });
  const s = await claimedSpace(model, "Asker Co");
  const ownerCall: Caller = async (cap, input = {}) => {
    try {
      return { status: 200, data: await s.api(cap, { idempotencyKey: `aw-${cap}-${++keys}`, ...input }) };
    } catch (e) {
      return { status: 500, data: String(e) };
    }
  };
  const ana = await join(s.d, ownerCall, "Member", "ana", "Ana Adler");
  const ben = await join(s.d, ownerCall, "Member", "ben", "Ben Brandt");
  // each member runs on an account of their own, connected the way a person connects it
  const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
  for (const [p, who] of [
    [ana, "ana"],
    [ben, "ben"],
  ] as const) {
    const call = as(s.d, p.token);
    const unlock = await fetch(`${s.d.url}/local/vault/key/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.token}` },
      body: JSON.stringify({ key: Buffer.alloc(32, who === "ana" ? 5 : 6).toString("base64") }),
    });
    assert.equal(unlock.status, 204, `unlock ${who}: ${unlock.status}`);
    const folder = await call("vault.folders.create", { name: "Accounts", scope: "mine" });
    const flow = await call("providers.subscription_start", { providerKey: "claude-code" });
    const item = await call("vault.item.put", {
      folderId: folder.data.folder.id,
      name: `${who}_Claude`,
      kind: "ai_subscription",
      fields: [{ key: "setup_token", value: KEY, secret: true }],
    });
    assert.equal(item.status, 200, JSON.stringify(item.data));
    const done = await call("providers.subscription_complete", { flowId: flow.data.flowId });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    // a routine or a wake runs on a person's own subscription only with this switch on
    const use = await call("providers.set_space_use", { providerId: done.data.provider.id, allow: true });
    assert.equal(use.status, 200, JSON.stringify(use.data));
  }
  const agent = (
    await s.api("agents.create", { name: "Dex", role: "You help the whole team.", idempotencyKey: "aw-dex" })
  ).agent.agentId as string;
  const w: World = {
    d: s.d,
    agent,
    assistant: s.assistant,
    owner: { id: s.owner, call: ownerCall },
    ana: { id: ana.id, call: as(s.d, ana.token) },
    ben: { id: ben.id, call: as(s.d, ben.token) },
    async turn(who, key, steps, agentId = agent) {
      const chat = await who.call("chat.start", { kind: "chat", agentIds: [agentId] });
      assert.equal(chat.status, 200, `chat.start: ${JSON.stringify(chat.data)}`);
      const threadId = chat.data.thread.threadId as string;
      await who.call("threads.set_mode", { threadId, mode: "auto" });
      const posted = await who.call("chat.post", {
        threadId,
        body: `RUN ${key} ${JSON.stringify(steps)}`,
        mentions: [{ kind: "agent", id: agentId }],
      });
      assert.equal(posted.status, 200, `chat.post: ${JSON.stringify(posted.data)}`);
      return waitFor(
        async () => {
          await w.d.hooks?.pump?.();
          return results.get(key) ?? null;
        },
        180_000,
        () => hostLog(w.d),
      );
    },
    async waitFor(key) {
      return waitFor(
        async () => {
          await w.d.hooks?.pump?.();
          return results.get(key) ?? null;
        },
        180_000,
        () => hostLog(w.d),
      );
    },
    async restart() {
      await stop(w.d);
      w.d = await boot(s.d.paths.root, model, {
        config: loadConfig(
          ["--data-dir", s.d.paths.root, "--port", "0", "--space", "spc_claimed", "--space-name", "Asker Co"],
          {},
          "1.2.3",
        ),
      });
      const signIn = async (username: string, password: string): Promise<string> => {
        const r = await fetch(`${w.d.url}/v1/identity/sign_in`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password, deviceName: "test", deviceClass: "desktop" }),
        });
        const body = (await r.json()) as { data?: { session?: { token?: string } } };
        assert.equal(r.status, 200, `sign in ${username}: ${JSON.stringify(body)}`);
        return body.data!.session!.token!;
      };
      const maya = as(w.d, await signIn("maya", "claimed space password 7731"));
      w.owner = { id: w.owner.id, call: maya };
      w.ana = { id: w.ana.id, call: as(w.d, await signIn("ana", "correct horse battery staple 9")) };
      w.ben = { id: w.ben.id, call: as(w.d, await signIn("ben", "correct horse battery staple 9")) };
    },
    async close() {
      await stop(w.d);
      if (saved === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
      else process.env["VYRE_WORKSPACE_IMAGE"] = saved;
      for (const n of (await workspaceNames()).filter((x) => !before.has(x))) {
        await docker(["rm", "-f", n]);
        await docker(["volume", "rm", "-f", `${n}-home`, `${n}-files`, `${n}-people`]);
      }
    },
  };
  return w;
}
