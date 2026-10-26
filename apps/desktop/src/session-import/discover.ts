import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DiscoveryOptions, SessionProvider, SessionSource } from "./types.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CODEX_FILE = new RegExp(`^rollout-(${UUID})\\.jsonl$`, "i");
const CLAUDE_FILE = new RegExp(`^(${UUID})\\.jsonl(?:\\.gz)?$`, "i");

export function providerRoots(provider: SessionProvider, options: DiscoveryOptions = {}): string[] {
  const configured = provider === "codex" ? options.codexHome : options.claudeHome;
  if (configured) return [path.resolve(configured)];
  const home = options.home ?? os.homedir();
  return [path.join(home, provider === "codex" ? ".codex" : ".claude")];
}

export async function discoverSessions(options: DiscoveryOptions = {}): Promise<SessionSource[]> {
  const out = [
    ...(await discoverCodex(providerRoots("codex", options))),
    ...(await discoverClaude(providerRoots("claude", options))),
  ];
  return out.sort((a, b) => a.sessionKey.localeCompare(b.sessionKey));
}

async function discoverCodex(roots: string[]): Promise<SessionSource[]> {
  const found: SessionSource[] = [];
  for (const root of roots) {
    const sessions = path.join(root, "sessions");
    for (const file of await containedFiles(sessions, root)) {
      const match = CODEX_FILE.exec(path.basename(file));
      if (!match?.[1]) continue;
      const sessionId = match[1].toLowerCase();
      found.push({ provider: "codex", sessionId, sessionKey: `codex:${sessionId}`, projectKey: "codex:unknown", transcriptPath: file });
    }
  }
  return unique(found);
}

async function discoverClaude(roots: string[]): Promise<SessionSource[]> {
  const found: SessionSource[] = [];
  for (const root of roots) {
    const metadata = await claudeMetadata(root);
    for (const area of ["projects", "projects-archive"]) {
      const base = path.join(root, area);
      for (const file of await containedFiles(base, root)) {
        const match = CLAUDE_FILE.exec(path.basename(file));
        if (!match?.[1]) continue;
        const sessionId = match[1].toLowerCase();
        const project = projectFromPath(base, file);
        const extra = metadata.get(sessionId);
        found.push({
          provider: "claude", sessionId, sessionKey: `claude:${sessionId}`, projectKey: `claude:${project}`,
          transcriptPath: file, ...(extra?.cwd ? { cwd: extra.cwd } : {}), ...(extra?.updatedAt ? { updatedAt: extra.updatedAt } : {}),
        });
      }
    }
  }
  return unique(found);
}

function projectFromPath(base: string, file: string): string {
  const relative = path.relative(base, file).split(path.sep);
  return relative[0] || "unknown";
}

async function containedFiles(start: string, root: string): Promise<string[]> {
  const base = await realDirectory(root);
  const startReal = await realDirectory(start);
  if (!base || !startReal || !contained(base, startReal)) return [];
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const candidate = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && contained(base, candidate)) files.push(candidate);
    }
  };
  await visit(startReal);
  return files;
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function realDirectory(dir: string): Promise<string | null> {
  try {
    const real = await fs.realpath(dir);
    return (await fs.stat(real)).isDirectory() ? real : null;
  } catch { return null; }
}

type ClaudeMetadata = { cwd?: string; updatedAt?: string };

async function claudeMetadata(root: string): Promise<Map<string, ClaudeMetadata>> {
  const out = new Map<string, ClaudeMetadata>();
  const home = path.basename(root) === ".claude" ? path.dirname(root) : root;
  const candidates = [
    path.join(home, "Library", "Application Support", "Claude", "claude-code-sessions"),
    path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions"),
  ];
  for (const dir of candidates) for (const file of await containedFiles(dir, root)) {
    if (!/^local_.*\.json$/i.test(path.basename(file))) continue;
    try {
      const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (!isRecord(value) || typeof value.sessionId !== "string") continue;
      const cwd = typeof value.cwd === "string" ? value.cwd : undefined;
      const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : undefined;
      out.set(value.sessionId.toLowerCase(), { ...(cwd ? { cwd } : {}), ...(updatedAt ? { updatedAt } : {}) });
    } catch { /* metadata is opportunistic */ }
  }
  return out;
}

function unique(sources: SessionSource[]): SessionSource[] {
  return [...new Map(sources.map((source) => [source.sessionKey, source])).values()];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
