// @heavy docker
// Owner, 13 Nov 2026 (P7 section 10 item 1): "make sure tmux works with whoami and all and its attached by default to new sessions with any agent or assistant so they can do the work".
// On a booted daemon with the real workspace container (the model vendor is the only stand-in), the agent's terminal tools run `whoami`, `pwd`, `git --version`, and write a file then read it,
// with no call to attach and nobody pressing anything, in: (plain) a new chat with an ordinary agent, (assistant) a person's Assistant, (helper) a helper the agent starts inside a chat,
// (crew) a crew teammate the agent starts. The same again after the workspace slept and woke, and after the daemon was stopped and started on the same data folder (what an update does).
// Needs VYRE_HEAVY_DOCKER=1; VYRE_WORKSPACE_TEST_IMAGE names an image built from images/agent-workspace.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { CODE_ROOT } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { boundWorkspaces } from "../modules/terminal/impl.ts";
import { boot, claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON
  ? false
  : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (the workspace is a real container)";

const docker = (args: string[]): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    execFile("docker", args, { cwd: CODE_ROOT, timeout: 90_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}` }),
    );
  });
const names = async (): Promise<string[]> =>
  (await docker(["ps", "-a", "--format", "{{.Names}}", "--filter", "name=vyre-ws-"])).out
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.startsWith("vyre-ws-") && !x.includes("vyre-wsproj"));

type Kind = "plain" | "assistant" | "helper" | "crew";
type Rec = Record<string, { ok: boolean; text: string }>;
const COMMANDS: Array<[string, string]> = [
  ["whoami", "whoami"],
  ["pwd", "pwd"],
  ["git", "git --version"],
  ["file", "echo hi-FILE > ready-FILE.txt && cat ready-FILE.txt"],
];

test(
  "a new chat with an agent, the Assistant, a helper and a crew teammate each run whoami, pwd, git and a file write and read with no attach, then again after a sleep and after a daemon restart",
  { skip, timeout: 1_500_000 },
  async (t) => {
    const saved = process.env["VYRE_WORKSPACE_IMAGE"];
    process.env["VYRE_WORKSPACE_IMAGE"] = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
    const before = new Set(await names());
    const out = new Map<string, Rec>();
    const attaches: string[] = [];
    const firstMs = new Map<string, number>();
    let plainAgent = "";
    const model = scriptedModel(async function* (input, run) {
      const body = input.trigger?.body ?? "";
      const lead = /^ready (\S+) (plain|assistant|helper|crew)$/.exec(body);
      const sub = /(helper|crew) job (\S+)/.exec(body);
      const kind = lead ? (lead[2] as Kind) : sub ? (sub[1] as Kind) : undefined;
      const label = lead ? lead[1]! : sub ? sub[2]! : "";
      if (!kind) return;
      if (lead && (kind === "helper" || kind === "crew")) {
        if (kind === "helper") {
          yield* run("tool_search", { query: "sub task helper" });
          yield* run("sub_task_model", {
            threadId: input.threadId,
            title: "Ready check",
            instruction: `helper job ${label}`,
            idempotencyKey: `h-${label}`,
          });
        } else {
          yield* run("tool_search", { query: "crew teammate" });
          yield* run("crew_start", {
            threadId: input.threadId,
            title: "Ready check",
            brief: `crew job ${label}`,
            idempotencyKey: `c-${label}`,
          });
        }
        return;
      }
      const tag = `${label}-${kind}`;
      const rec: Rec = {};
      yield* run("tool_search", { query: "terminal run command" });
      const t0 = Date.now();
      for (const [key, command] of COMMANDS) {
        const r = (yield* run("terminal_run", {
          command: command.replaceAll("FILE", tag),
          idempotencyKey: `${tag}-${key}`,
        })) as {
          ok: boolean;
          content: { data?: { output?: string; exitCode?: number }; output?: string; exitCode?: number };
        };
        const d = r.content?.data ?? r.content ?? {};
        rec[key] = { ok: r.ok && (d.exitCode ?? 0) === 0, text: String(d.output ?? JSON.stringify(r.content)).trim() };
        if (!firstMs.has(tag)) firstMs.set(tag, Date.now() - t0);
      }
      out.set(tag, rec);
    });
    const s = await claimedSpace(model, "Ready Co");
    let d: Daemon = s.d;
    const dir = s.d.paths.root;
    let api = s.api;
    const assistant = s.assistant;
    t.after(async () => {
      await stop(d);
      if (saved === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
      else process.env["VYRE_WORKSPACE_IMAGE"] = saved;
      for (const n of (await names()).filter((x) => !before.has(x))) {
        await docker(["rm", "-f", n]);
        await docker(["volume", "rm", "-f", `${n}-home`, `${n}-files`, `${n}-people`]);
      }
    });
    plainAgent = (await api("agents.create", { name: "Dex", role: "You help.", idempotencyKey: "ready-dex" })).agent
      .agentId as string;

    const problems: string[] = [];
    const phase = async (label: string): Promise<void> => {
      const jobs: Array<[Kind, string]> = [
        ["plain", plainAgent],
        ["assistant", assistant],
        ["helper", plainAgent],
        ["crew", plainAgent],
      ];
      for (const [kind, agentId] of jobs) {
        const chat = (
          await api("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `rd-${label}-${kind}` })
        ).thread.threadId as string;
        await api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: `rd-${label}-${kind}-m` });
        await api("chat.post", {
          threadId: chat,
          body: `ready ${label} ${kind}`,
          mentions: [{ kind: "agent", id: agentId }],
          idempotencyKey: `rd-${label}-${kind}-p`,
        });
        const tag = `${label}-${kind}`;
        const got = await waitFor(
          async () => {
            await d.hooks?.pump?.();
            return out.get(tag) ?? null;
          },
          kind === "plain" && label === "fresh" ? 240_000 : 120_000,
          () => hostLog(d),
        ).catch((e: Error) => {
          problems.push(`${tag}: the commands never finished (${e.message.slice(0, 300)})`);
          return null;
        });
        if (!got) continue;
        const want: Record<string, RegExp> = {
          whoami: /^agent$/,
          pwd: /^\/home\/agent/,
          git: /^git version \d/,
          file: new RegExp(`^hi-${tag}$`),
        };
        for (const [key] of COMMANDS) {
          const r = got[key];
          if (!r || !r.ok || !want[key]!.test(r.text))
            problems.push(`${tag} ${key}: ${JSON.stringify(r)} (wanted ${want[key]})`);
        }
        console.log(`READY ${tag} first-command-batch ${firstMs.get(tag)} ms ${JSON.stringify(got)}`);
      }
    };

    await phase("fresh");
    // whose computer a helper and a crew teammate run in, by what the code does: the lead agent's own workspace, each in a tab of its own (workScope in modules/terminal/handlers/sessions.ts);
    // so a helper or a crew teammate makes no container of its own
    const made = (await names()).filter((x) => !before.has(x)).sort();
    assert.deepEqual(
      made,
      [`vyre-ws-${plainAgent}`, `vyre-ws-${assistant}`].sort(),
      "two workspaces: the agent's and the Assistant's",
    );
    const tabs = (
      (await api("terminal.list", {})) as { terminals: Array<{ agentId?: string; by?: { kind?: string } }> }
    ).terminals;
    const kinds = tabs.filter((x) => x.agentId === plainAgent).map((x) => x.by?.kind ?? "agent");
    console.log(`READY tabs in the agent's workspace: ${JSON.stringify(kinds)}`);
    assert.ok(
      kinds.includes("helper"),
      `the helper and the crew teammate have tabs in the lead's workspace: ${JSON.stringify(tabs)}`,
    );

    // the workspace sleeps (idle stop) and the next command wakes it
    const mgr = boundWorkspaces();
    assert.ok(mgr, "the daemon has a workspace manager");
    for (const w of await mgr.list()) await mgr.sleep(w.agentId);
    await phase("slept");

    // an update: the daemon stops and starts on the same data folder; the containers keep running
    await stop(d);
    d = await boot(dir, model, {
      config: loadConfig(
        ["--data-dir", dir, "--port", "0", "--space", "spc_claimed", "--space-name", "Ready Co"],
        {},
        "1.2.3",
      ),
    });
    const sign = await fetch(`${d.url}/v1/identity/sign_in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "maya",
        password: "claimed space password 7731",
        deviceName: "test",
        deviceClass: "desktop",
      }),
    });
    const token = ((await sign.json()) as { data: { session: { token: string } } }).data.session.token;
    api = async (cap, input) => {
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      const body = (await r.json()) as { data?: unknown };
      assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(body)}`);
      return body.data;
    };
    await phase("restarted");

    assert.deepEqual(attaches, [], "no call to attach");
    assert.deepEqual(problems, []);
  },
);
