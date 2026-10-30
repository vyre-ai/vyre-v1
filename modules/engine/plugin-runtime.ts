// Where plugin code runs (CHAT-DESIGN ruling 6). A plugin's MCP server and its hooks are programs a stranger wrote, so they run only in the agent's sandbox: the same Seatbelt (Mac) or bubblewrap
// (Linux) wrap a CLI engine runs in, with the person's work folder as the only place they can write and the egress wall as the only way out. This file starts them, keeps the MCP connections
// open between turns, and never runs anything in the daemon. A remote MCP server (a URL) is reached through a guarded fetch and runs nowhere near here.
// Secrets: an env value, argument or header that is a Vault handle (#Name.field) is filled at the last moment, for the person asking, from the Vault, and every result that comes back is scrubbed
// of it. A handle the asker may not use refuses the call; nothing is filled for a plugin on the Space host's behalf.
import fs from "node:fs";
import path from "node:path";
import { createLocalLauncher } from "../../agent/src/drivers/cli/launcher.ts";
import type { CliProcess } from "../../agent/src/drivers/cli/types.ts";
import { McpClient, McpError, httpTransport, resultText, stdioTransport } from "../../agent/src/mcp-client/index.ts";
import type { FetchPort, McpTool } from "../../agent/src/mcp-client/index.ts";
import { createScrubber, handlesIn, WITHHELD } from "../../agent/src/vault-use/index.ts";
import type { Secret, ValueSource, VaultRunDeps } from "../../agent/src/vault-use/index.ts";
import { expandVars } from "../../lib/plugin-format.ts";
import { sandboxWrap, workFolder } from "./sandbox.ts";
import type { SandboxPlan } from "./sandbox.ts";

/** One MCP server as `plugins.mcp.servers` describes it. */
export interface ServerSpec {
  key: string; name: string; from: "plugin" | "connection"; pluginId?: string; transport: "stdio" | "http" | "sse" | "ws";
  command?: string; args: string[]; env: Record<string, string>; url?: string; headers: Record<string, string>; files?: string; needs: string[];
}
/** One hook as `plugins.hooks.list` describes it. */
export interface HookSpec { pluginId: string; plugin: string; event: string; matcher: string; command: string; args: string[]; timeoutSec?: number }
export interface Who { agentId: string; asker: string }

export interface PluginRuntimeDeps {
  /** Calls a capability as the asker (plugins.files, plugins.mcp.servers ...). */
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  /** The sandbox plan for this machine. Rejects with sandbox.unavailable where plugin code cannot be confined, and then nothing starts. */
  plan(): Promise<SandboxPlan>;
  dataDir: string;
  /** Resolves a Vault handle for the asker. Without it, a handle is refused. */
  source?: ValueSource;
  reportMiss?: VaultRunDeps["reportMiss"];
  /** The fetch for remote servers: the network guard's, so a private address is refused. */
  fetch?: FetchPort;
  /** Replaces the process launcher (tests). */
  launch?: (argv: readonly string[], start: { env: Record<string, string>; cwd: string }) => Promise<CliProcess>;
  now?: () => number;
  /** Idle connections close after this long. Default 10 minutes. */
  idleMs?: number;
}

export class PluginError extends Error {
  readonly code: "permission.no_grant" | "provider.unavailable" | "validation.bad_input" | "validation.precondition_failed";
  constructor(code: PluginError["code"], message: string) { super(message); this.name = "PluginError"; this.code = code; }
}

interface Live { client: McpClient; secrets: Secret[]; last: number; spec: string }
const HOOK_OUT = 64_000;
const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export function createPluginRuntime(d: PluginRuntimeDeps) {
  const live = new Map<string, Live>();
  const connecting = new Map<string, Promise<Live>>();
  const now = d.now ?? Date.now;
  const idleMs = d.idleMs ?? 600_000;

  /** The plugin's files, written into the person's work folder for the sandbox. A new copy each time, so a plugin cannot keep a changed copy of itself. */
  async function stage(pluginId: string, who: Who, cwd: string): Promise<{ root: string; data: string }> {
    const got = (await d.call("plugins.files", { pluginId }, who.asker)) as { files: Record<string, string> };
    const root = path.join(cwd, ".plugins", pluginId);
    fs.rmSync(root, { recursive: true, force: true });
    for (const [rel, text] of Object.entries(got.files)) {
      const abs = path.join(root, rel);
      if (path.relative(root, abs).startsWith("..")) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, { mode: rel.endsWith(".sh") || rel.startsWith("bin/") ? 0o755 : 0o644 });
    }
    const data = path.join(cwd, ".plugin-data", pluginId);
    fs.mkdirSync(data, { recursive: true });
    return { root, data };
  }

  /** Handles in `texts` resolved to values for the asker. A handle that is not a Vault item stays as written. */
  async function fill(texts: readonly string[], who: Who): Promise<{ values: Map<string, string>; secrets: Secret[] }> {
    const values = new Map<string, string>();
    const secrets: Secret[] = [];
    for (const h of new Set(texts.flatMap((t) => handlesIn(t)))) {
      if (!d.source) throw new PluginError("permission.no_grant", `${h} is a Vault handle and this server has no Vault to fill it from.`);
      const r = await d.source.lookup(h, { agentId: who.agentId, asker: who.asker, where: "computer" });
      if (r.kind === "unknown") continue;
      if (r.kind === "denied") throw new PluginError("permission.no_grant", `You cannot use ${h} here.`);
      values.set(h, r.value);
      secrets.push({ handle: h, itemId: r.itemId, value: r.value });
    }
    return { values, secrets };
  }
  const sub = (text: string, values: Map<string, string>): string => {
    let out = text;
    for (const h of [...values.keys()].sort((a, b) => b.length - a.length)) out = out.split(h).join(values.get(h)!);
    return out;
  };

  async function launch(argv: readonly string[], env: Record<string, string>, cwd: string): Promise<CliProcess> {
    if (d.launch) return d.launch(argv, { env, cwd });
    const plan = await d.plan();
    return createLocalLauncher({ wrap: sandboxWrap(plan) }).spawn({ argv, env, cwd });
  }

  async function open(spec: ServerSpec, who: Who): Promise<Live> {
    const sig = hash(JSON.stringify([spec.transport, spec.command, spec.args, spec.env, spec.url, spec.headers, spec.files]));
    if (spec.needs.length > 0) throw new PluginError("validation.precondition_failed", `${spec.name} needs ${spec.needs.join(", ")} set first.`);
    if (spec.transport === "stdio") {
      if (!spec.command) throw new PluginError("validation.bad_input", `${spec.name} has no command.`);
      const cwd = workFolder(d.dataDir, who.asker, "plugins");
      const staged = spec.files ? await stage(spec.files, who, cwd) : { root: cwd, data: path.join(cwd, ".plugin-data") };
      const vars = { CLAUDE_PLUGIN_ROOT: staged.root, CLAUDE_PLUGIN_DATA: staged.data, CLAUDE_PROJECT_DIR: cwd };
      const { values, secrets } = await fill([spec.command, ...spec.args, ...Object.values(spec.env)], who);
      const argv = [spec.command, ...spec.args].map((a) => sub(expandVars(a, vars), values));
      const env: Record<string, string> = { HOME: cwd, ...vars };
      for (const [k, v] of Object.entries(spec.env)) env[k] = sub(expandVars(v, vars), values);
      let proc: CliProcess;
      try { proc = await launch(argv, env, cwd); }
      catch (e) { throw new PluginError("provider.unavailable", e instanceof Error ? e.message : "Could not start the server."); }
      try {
        const client = await McpClient.connect(stdioTransport(proc), { timeoutMs: 20_000 });
        return { client, secrets, last: now(), spec: sig };
      } catch (e) { throw new PluginError("provider.unavailable", `${spec.name} did not start: ${e instanceof Error ? e.message : "no answer"}`); }
    }
    if (spec.transport === "http") {
      if (!spec.url) throw new PluginError("validation.bad_input", `${spec.name} has no URL.`);
      if (!d.fetch) throw new PluginError("provider.unavailable", "This server cannot reach remote MCP servers.");
      const { values, secrets } = await fill([spec.url, ...Object.values(spec.headers)], who);
      const headers = Object.fromEntries(Object.entries(spec.headers).map(([k, v]) => [k, sub(v, values)]));
      try {
        const client = await McpClient.connect(httpTransport({ url: sub(spec.url, values), fetch: d.fetch, headers: () => headers }), { timeoutMs: 20_000 });
        return { client, secrets, last: now(), spec: sig };
      } catch (e) { throw new PluginError("provider.unavailable", `${spec.name} did not answer: ${e instanceof Error ? e.message : "no answer"}`); }
    }
    throw new PluginError("validation.precondition_failed", `${spec.name} uses ${spec.transport}, which is not supported yet. Use a command or an https URL.`);
  }

  async function connection(spec: ServerSpec, who: Who): Promise<Live> {
    const key = `${who.asker}|${who.agentId}|${spec.key}`;
    const sig = hash(JSON.stringify([spec.transport, spec.command, spec.args, spec.env, spec.url, spec.headers, spec.files]));
    const cur = live.get(key);
    if (cur && !cur.client.isClosed && cur.spec === sig) { cur.last = now(); return cur; }
    if (cur) { void cur.client.close(); live.delete(key); }
    const pending = connecting.get(key);
    if (pending) return pending;
    const p = open(spec, who).then((l) => { live.set(key, l); return l; }).finally(() => connecting.delete(key));
    connecting.set(key, p);
    return p;
  }

  const timer = setInterval(() => {
    for (const [k, l] of live) if (now() - l.last > idleMs) { void l.client.close(); live.delete(k); }
  }, 60_000);
  timer.unref();

  return {
    /** The tools of one server. A server that is down or still waiting for an option throws a PluginError saying why. */
    async tools(spec: ServerSpec, who: Who): Promise<McpTool[]> {
      const l = await connection(spec, who);
      try { return await l.client.listTools(); }
      catch (e) { live.delete(`${who.asker}|${who.agentId}|${spec.key}`); throw new PluginError("provider.unavailable", e instanceof Error ? e.message : "The server did not answer."); }
    },
    /** Calls one tool. The text has any filled secret removed; a leftover fragment withholds it whole. */
    async callTool(spec: ServerSpec, who: Who, tool: string, args: unknown): Promise<{ isError: boolean; text: string; structured?: unknown }> {
      const l = await connection(spec, who);
      let r;
      try { r = await l.client.callTool(tool, args); }
      catch (e) {
        live.delete(`${who.asker}|${who.agentId}|${spec.key}`);
        if (e instanceof McpError && e.code === "mcp.server_error") return { isError: true, text: e.message };
        throw new PluginError("provider.unavailable", e instanceof Error ? e.message : "The server did not answer.");
      }
      let text = resultText(r);
      if (l.secrets.length > 0) {
        const s = createScrubber(l.secrets);
        const scrubbed = s.scrub(text);
        const miss = s.residual(scrubbed);
        if (miss.length > 0) { for (const m of miss) await d.reportMiss?.({ itemId: m.itemId, place: "terminal", traceId: "0".repeat(32) }); text = WITHHELD; }
        else text = scrubbed;
      }
      return { isError: r.isError, text, ...(r.structured !== undefined && l.secrets.length === 0 ? { structured: r.structured } : {}) };
    },
    /**
     * Runs one hook command in the sandbox with the event as JSON on its standard input. Exit code 2 means "block" for a Pre hook, as in Claude Code. A hook that cannot be confined does not run.
     * Output is bounded and scrubbed.
     */
    async runHook(hook: HookSpec, who: Who, event: unknown): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
      const cwd = workFolder(d.dataDir, who.asker, "plugins");
      const staged = await stage(hook.pluginId, who, cwd);
      const vars = { CLAUDE_PLUGIN_ROOT: staged.root, CLAUDE_PLUGIN_DATA: staged.data, CLAUDE_PROJECT_DIR: cwd };
      const { values, secrets } = await fill([hook.command, ...hook.args], who);
      const argv = hook.args.length > 0 ? [hook.command, ...hook.args].map((a) => sub(expandVars(a, vars), values)) : ["/bin/sh", "-c", sub(expandVars(hook.command, vars), values)];
      const proc = await launch(argv, { HOME: cwd, ...vars }, cwd);
      let out = "";
      const read = (async () => { for await (const c of proc.stdout) { out += typeof c === "string" ? c : Buffer.from(c).toString("utf8"); if (out.length > HOOK_OUT) out = out.slice(0, HOOK_OUT); } })();
      proc.write(`${JSON.stringify(event)}\n`).then(() => proc.endInput(), () => undefined);
      let timedOut = false;
      const t = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, (hook.timeoutSec ?? 30) * 1000);
      const exit = await proc.exited;
      clearTimeout(t);
      await read.catch(() => undefined);
      const clean = (s: string): string => (secrets.length > 0 ? createScrubber(secrets).scrub(s) : s);
      return { code: exit.code, stdout: clean(out), stderr: clean(proc.stderrTail()), timedOut };
    },
    /** Closes the connections of servers that are gone from `keys` (an uninstalled plugin) or all of them. */
    async closeAll(): Promise<void> {
      clearInterval(timer);
      const all = [...live.values()];
      live.clear();
      await Promise.all(all.map((l) => l.client.close()));
    },
    live: (): number => live.size,
  };
}
export type PluginRuntime = ReturnType<typeof createPluginRuntime>;
