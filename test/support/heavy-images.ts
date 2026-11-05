// Image names for the heavy (real Docker) tests. A dockerd is shared by every job on its host: a test that builds or tags a fixed name (vyre/person-sandbox:1, vyre/agent-computer:1) can replace the image under
// another job's running containers. So: the name comes from the environment when the caller (a workflow step) names one, and otherwise it is private to this process (hv<pid><random>), built here when missing
// and removed when the process exits. No file needs a shared tag, and a file run alone by hand works without any :1.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const priv = `hv${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const mine = new Set<string>();
let hooked = false;
function removeAtExit(tag: string): void {
  mine.add(tag);
  if (hooked) return;
  hooked = true;
  process.on("exit", () => { for (const t of mine) spawnSync("docker", ["rmi", "-f", t], { stdio: "ignore" }); });
}
const exists = (tag: string): boolean => spawnSync("docker", ["image", "inspect", tag], { stdio: "ignore" }).status === 0;
function build(tag: string, dir: string, args: string[] = []): void {
  const r = spawnSync("docker", ["build", "-t", tag, ...args, dir], { cwd: ROOT, encoding: "utf8", timeout: 1_200_000 });
  if (r.status !== 0) throw new Error(`building ${tag} failed: ${(r.stderr ?? "").slice(-800)}`);
}

/** The person-sandbox image's name for this run: VYRE_SANDBOX_IMAGE when set, else a private tag. Only a name: nothing is built until sandboxImage(). */
export function sandboxImageName(): string { return process.env["VYRE_SANDBOX_IMAGE"] ?? `vyre/person-sandbox:${priv}`; }
/** The image itself: the name above, built from images/person-sandbox when it is not on this dockerd (a private tag is removed when the process exits; a named one is the caller's). */
export function sandboxImage(): string {
  const tag = sandboxImageName();
  if (!exists(tag)) { build(tag, "images/person-sandbox", ["--build-arg", "ENGINE_PACKAGES=is-odd@3.0.1"]); if (process.env["VYRE_SANDBOX_IMAGE"] === undefined) removeAtExit(tag); }
  return tag;
}

/** The agent computer image's name for this run: VYRE_AGENT_COMPUTER_IMAGE when set, else a private live-style tag (removed at exit when something built it through here). */
export function agentComputerImageName(): string { return process.env["VYRE_AGENT_COMPUTER_IMAGE"] ?? `vyre/agent-computer:live-${priv}`; }
/** The agent computer image, built from images/agent-computer when it is not on this dockerd. A test that builds it itself (with Vyre for Chrome in the context) calls agentComputerImageName() and registerImage() instead. */
export function agentComputerImage(): string {
  const tag = agentComputerImageName();
  if (!exists(tag)) { build(tag, "images/agent-computer"); if (process.env["VYRE_AGENT_COMPUTER_IMAGE"] === undefined) removeAtExit(tag); }
  return tag;
}
/** Remove this image when the process exits (for a test that builds a private tag itself). */
export function registerImage(tag: string): void { removeAtExit(tag); }
