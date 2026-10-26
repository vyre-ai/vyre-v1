// Vyre for Chrome inside the agent-computer image (P-L11_18, compB's finding): the image build copies the extension into images/agent-computer/vyre-chrome/ first, and a check proves the
// built image holds it. Before this, the extension was in the image only when someone copied it by hand, and agentd then ran the browser without it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["tests", "node_modules", "package.json"]);

/** Copy apps/chrome (manifest.json and src, without tests or package.json) into the image's build context. Returns the files copied. */
export function stageChrome(root: string): string[] {
  const from = path.join(root, "apps/chrome");
  const to = path.join(root, "images/agent-computer/vyre-chrome");
  if (!fs.existsSync(path.join(from, "manifest.json"))) throw new Error("apps/chrome/manifest.json is missing");
  fs.mkdirSync(to, { recursive: true });
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (rel === "" && SKIP.has(e.name)) continue;
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) { fs.mkdirSync(path.join(to, r), { recursive: true }); walk(path.join(dir, e.name), r); }
      else { fs.copyFileSync(path.join(dir, e.name), path.join(to, r)); out.push(r); }
    }
  };
  walk(from, "");
  return out.sort();
}

export type Run = (cmd: string, args: string[]) => string;
const real: Run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The image must hold /opt/vyre-chrome/manifest.json, a valid manifest with a version, and the same source files. Throws naming what is missing. */
export function imageHasChrome(image: string, expectedFiles: readonly string[], run: Run = real): void {
  let manifest: string;
  try { manifest = run("docker", ["run", "--rm", "--entrypoint", "cat", image, "/opt/vyre-chrome/manifest.json"]); } catch { throw new Error(`${image} has no /opt/vyre-chrome/manifest.json: Vyre for Chrome is not in the image`); }
  let version: unknown;
  try { version = (JSON.parse(manifest) as { version?: unknown }).version; } catch { throw new Error(`${image}: /opt/vyre-chrome/manifest.json is not JSON`); }
  if (typeof version !== "string" || version === "") throw new Error(`${image}: the baked manifest has no version`);
  const listed = run("docker", ["run", "--rm", "--entrypoint", "find", image, "/opt/vyre-chrome", "-type", "f"]).split("\n").map((l) => l.replace(/^\/opt\/vyre-chrome\//, "")).filter((l) => l !== "" && l !== ".gitkeep");
  const missing = expectedFiles.filter((f) => !listed.includes(f));
  if (missing.length > 0) throw new Error(`${image} is missing ${missing.length} extension file(s): ${missing.slice(0, 5).join(", ")}`);
}
