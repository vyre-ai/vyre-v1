// The signing runner label (docs/release/runbook.md): `release-sign` belongs to one job, `sign` in release.yml, and to no other job of any workflow. A shared CI runner that took that label
// would run other people's code beside the signing key.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "release-sign";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(root, ".github/workflows");

/** Jobs of one workflow file that name the label in `runs-on`, read from the text: a job is a two-space key under `jobs:`. */
export function jobsWithLabel(text: string): string[] {
  const out: string[] = [];
  let inJobs = false, job = "";
  for (const line of text.split("\n")) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (inJobs && /^\S/.test(line) && !line.startsWith("#")) inJobs = false;
    if (!inJobs) continue;
    const j = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (j) { job = j[1] ?? ""; continue; }
    if (/^\s+runs-on:/.test(line) && line.includes(LABEL)) out.push(job);
  }
  return out;
}

test("only the sign job of release.yml names the signing runner label", () => {
  const found: Record<string, string[]> = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"))) {
    const jobs = jobsWithLabel(fs.readFileSync(path.join(dir, f), "utf8"));
    if (jobs.length > 0) found[f] = jobs;
  }
  assert.deepEqual(found, { "release.yml": ["sign"] });
});

test("the label check reads jobs correctly and catches a second job that names it", () => {
  const bad = ["name: x", "jobs:", "  a:", "    runs-on: [self-hosted, linux, v1]", "  b:", "    runs-on: [self-hosted, linux, release-sign]", "  c:", "    runs-on: ubuntu-latest", ""].join("\n");
  assert.deepEqual(jobsWithLabel(bad), ["b"]);
  assert.deepEqual(jobsWithLabel("name: x\njobs:\n  a:\n    runs-on: ubuntu-latest\n"), []);
  assert.deepEqual(jobsWithLabel("# release-sign in a comment\njobs:\n  a:\n    steps:\n      - run: echo release-sign\n"), []);
});

test("the sign job runs in a container with its capabilities dropped, and the runbook tells the owner to register the runner and require approval", () => {
  const text = fs.readFileSync(path.join(dir, "release.yml"), "utf8");
  const sign = text.slice(text.indexOf("\n  sign:\n"), text.indexOf("\n  sign-dryrun:\n"));
  assert.match(sign, /container:\n\s+image: node:24-bookworm-slim@sha256:[0-9a-f]{64}/);
  assert.match(sign, /--cap-drop ALL --security-opt no-new-privileges/);
  assert.match(sign, /environment: release/);
  const book = fs.readFileSync(path.join(root, "docs/release/runbook.md"), "utf8");
  assert.match(book, /ONE self-hosted runner with the labels `self-hosted, linux, release-sign`/);
  assert.match(book, /Require approval for all outside collaborators/);
});
