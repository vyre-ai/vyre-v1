// Plugins on a Claude Code or Codex agent, natively (CHAT-DESIGN ruling 6): the plugin is written into the engine's own configuration inside its sandbox work folder, so the CLI sees its commands,
// skills and agents itself and starts its MCP servers. Claude Code reads the plugin folder (`--plugin-dir`); Codex gets the skills in its skills folders and the servers as config overrides.
// A secret is never written: a server's env value that is a Vault handle becomes an environment variable the CLI expands, and the host fills it through the existing fill at launch.
// Hooks are not wired here: they run only in the sandbox through Vyre's own tools, and a CLI runs its own tools.
import fs from "node:fs";
import path from "node:path";
import type { NativePlugins } from "../../agent/src/drivers/cli/types.ts";
import { parseSkill } from "../../lib/skill-md.ts";

interface PluginRow { pluginId: string; name: string; enabled: boolean }
interface Spec { key: string; name: string; from: "plugin" | "connection"; pluginId?: string; transport: string; command?: string; args: string[]; env: Record<string, string>; needs: string[] }
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

export interface NativeDeps { call(cap: string, input: unknown, as?: string): Promise<unknown> }

function write(root: string, files: Record<string, string>): void {
  fs.rmSync(root, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    if (path.relative(root, abs).startsWith("..")) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, { mode: rel.endsWith(".sh") || rel.startsWith("bin/") ? 0o755 : 0o644 });
  }
}

/** Writes the agent's enabled plugins into `work` and returns what the CLI is started with. Null when the agent has none. Every read runs as the asker. */
export async function nativePlugins(d: NativeDeps, driver: "claude_code" | "codex", agentId: string, asker: string, work: string): Promise<NativePlugins | null> {
  const plugins = ((await d.call("plugins.list", { agentId }, asker).catch(() => ({ plugins: [] }))) as { plugins: PluginRow[] }).plugins.filter((p) => p.enabled);
  if (plugins.length === 0) return null;
  const dirs: string[] = [];
  const roots = new Map<string, string>();
  for (const p of plugins) {
    const files = ((await d.call("plugins.files", { pluginId: p.pluginId }, asker).catch(() => ({ files: {} }))) as { files: Record<string, string> }).files;
    const root = path.join(work, ".plugins", p.pluginId);
    write(root, files);
    roots.set(p.pluginId, root);
    dirs.push(root);
    if (driver === "codex") {
      // Codex has no plugin folder: the skills go where it looks for them, named for their plugin
      for (const rel of Object.keys(files).filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f))) {
        const r = parseSkill(files[rel]!, rel.split("/")[1]);
        if (!r.ok) continue;
        for (const base of [".agents/skills", ".codex/skills"]) {
          const dir = path.join(work, base, `${p.name}-${r.skill.name}`);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "SKILL.md"), files[rel]!);
        }
      }
    }
  }
  const servers = ((await d.call("plugins.mcp.servers", { agentId }, asker).catch(() => ({ servers: [] }))) as { servers: Spec[] }).servers;
  const mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {};
  const secrets: Record<string, string> = {};
  let n = 0;
  for (const s of servers) {
    // a plugin's own stdio server only: a remote one cannot be reached from the sandbox, and a connection made by hand is Vyre's to run
    if (s.from !== "plugin" || s.transport !== "stdio" || !s.command || s.needs.length > 0 || !s.pluginId || !roots.has(s.pluginId)) continue;
    const root = roots.get(s.pluginId)!;
    const fix = (t: string): string => t.replaceAll("${CLAUDE_PLUGIN_ROOT}", root).replaceAll("${CLAUDE_PLUGIN_DATA}", path.join(work, ".plugin-data", s.pluginId!));
    const env: Record<string, string> = {};
    let ok = true;
    for (const [k, v] of Object.entries(s.env)) {
      if (HANDLE.test(v)) { const name = `VYRE_PLUGIN_${++n}`; secrets[name] = v; env[k] = "${" + name + "}"; }
      else if (/#[A-Za-z0-9_]+/.test(v)) ok = false;   // a handle inside other text is not filled
      else env[k] = fix(v);
    }
    if (!ok) continue;
    mcpServers[s.name] = { command: fix(s.command), args: s.args.map(fix), env };
  }
  return { dirs, mcpServers, secrets };
}
