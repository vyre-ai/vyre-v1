// The expo export command for a shots script: the binary comes from the repo's own node_modules (never another worktree's, which makes expo-router look for the app there and ship stale UI),
// and on a box that has /root/export-slot.sh the export waits for a free slot so ten exports never run at once.
import fs from "node:fs";
import path from "node:path";

export function exportCmd(repoRoot) {
  const expo = path.resolve(repoRoot, "node_modules/.bin/expo");
  const cmd = `${expo} export --platform web --output-dir dist`;
  return fs.existsSync("/root/export-slot.sh") ? `/root/export-slot.sh ${cmd}` : cmd;
}
