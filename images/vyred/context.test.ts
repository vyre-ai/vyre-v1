// The server image carries every file the code reads at run time. rc.14 left docs/ out of the build context (Dockerfile.dockerignore), so docs/frozen/agent-tools.md, which the MCP
// and engine modules read at start, was missing and vyred crash-looped on every fresh server. This reads the ignore file the way BuildKit does and checks, against it:
//   - every file an `// @reads /...` line names under modules/, host/ and agent/ (generated files included);
//   - every repo path a run-time source file names as a string literal ("docs/frozen/agent-tools.md", "generated/registry.json");
//   - the desktop bundle check's list of files a Space needs to run an agent (apps/desktop/src-tauri/ci/bundle-check.ts).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../..");

interface Rule { negate: boolean; re: RegExp }

/** One .dockerignore pattern as a regex over a slash path relative to the context. `*` and `?` stay inside one path segment; `**` crosses any number of them, none included. */
function patternRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** The rules of a .dockerignore, in order: comments and blank lines dropped, a leading `/` and `./` dropped, `!` marks a re-include. */
function parseDockerignore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1).trim();
    line = path.posix.normalize(line).replace(/^\/+/, "").replace(/\/+$/, "");
    if (!line || line === ".") continue;
    rules.push({ negate, re: patternRegex(line) });
  }
  return rules;
}

/** BuildKit's answer for one file: a rule hits when it matches the file or any folder above it, and the last rule that hits wins. */
function excluded(rules: readonly Rule[], file: string): boolean {
  const parts = file.split("/");
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  let out = false;
  for (const r of rules) if (candidates.some((c) => r.re.test(c))) out = !r.negate;
  return out;
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", ".turbo", "coverage", "target", ".git"]);
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}
const rel = (abs: string): string => path.relative(repo, abs).split(path.sep).join("/");
const isFile = (p: string): boolean => { try { return fs.statSync(path.join(repo, p)).isFile(); } catch { return false; } };
const isTest = (p: string): boolean => /\.test\.[a-z]+$|(^|\/)(tests?|fixtures|__fixtures__)\//.test(p);

const rules = parseDockerignore(fs.readFileSync(path.join(repo, "images/vyred/Dockerfile.dockerignore"), "utf8"));
const sources = ["modules", "host", "agent"].flatMap((d) => walk(path.join(repo, d)));

test("the ignore-file reader follows BuildKit: last match wins, ! re-includes under an excluded folder, ** spans folders, a folder rule covers what is inside it", () => {
  const r = parseDockerignore("# comment\n\ndocs\n!docs/frozen\n**/*.pem\n/spikes/\napps/app/dist/**/.env\n!keep.pem\n");
  assert.equal(excluded(r, "docs/spec/a.md"), true);
  assert.equal(excluded(r, "docs/frozen/agent-tools.md"), false);
  assert.equal(excluded(r, "docs"), true);
  assert.equal(excluded(r, "key.pem"), true, "** matches no folder at all");
  assert.equal(excluded(r, "a/b/c/key.pem"), true);
  assert.equal(excluded(r, "keep.pem"), false, "a later ! wins");
  assert.equal(excluded(r, "spikes/x/y.ts"), true);
  assert.equal(excluded(r, "apps/app/dist/.env"), true);
  assert.equal(excluded(r, "apps/app/dist/a/b/.env"), true);
  assert.equal(excluded(r, "apps/app/dist/a/b/env.js"), false);
  assert.equal(excluded(r, "docsy/a.md"), false, "a name is a whole segment");
  assert.equal(excluded(parseDockerignore("*.md\n"), "docs/a.md"), false, "* does not cross a folder");
});

test("every file an @reads line names under modules/, host/ and agent/ is in the server image's build context", () => {
  const named = new Map<string, string>();
  for (const f of sources) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/^\s*\/\/\s*@reads\s+\/(\S+)/gm)) {
      const target = m[1]!;
      if (!named.has(target)) named.set(target, rel(f));
    }
  }
  assert.ok(named.has("docs/frozen/agent-tools.md"), "the file that crash-looped rc.14 is named");
  assert.ok([...named.keys()].some((t) => t.startsWith("generated/")), "generated files are named too");
  const missing = [...named].filter(([t]) => isFile(t) && excluded(rules, t)).map(([t, by]) => `${t} (read by ${by})`);
  assert.deepEqual(missing, [], "Dockerfile.dockerignore leaves out files the code reads");
});

test("every repo path a run-time source file names as a string is in the build context", () => {
  const named = new Map<string, string>();
  for (const f of sources) {
    const r = rel(f);
    if (isTest(r)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/["'`]((?:docs|generated|perf|images|kernel|modules|host|agent|sandbox|fixtures)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)["'`]/g)) {
      const target = m[1]!;
      if (isFile(target) && !named.has(target)) named.set(target, r);
    }
  }
  assert.ok(named.has("docs/frozen/agent-tools.md") && named.has("generated/registry.json"), "the scan sees the reads that matter");
  const missing = [...named].filter(([t]) => excluded(rules, t)).map(([t, by]) => `${t} (named in ${by})`);
  assert.deepEqual(missing, [], "Dockerfile.dockerignore leaves out files the code names");
});

test("the files the desktop bundle check needs for an agent are in the server image too", () => {
  const src = fs.readFileSync(path.join(repo, "apps/desktop/src-tauri/ci/bundle-check.ts"), "utf8");
  const list = /const need = \[([\s\S]*?)\];/.exec(src)?.[1];
  assert.ok(list, "bundle-check.ts still lists what it needs in `const need = [...]`");
  // node_modules is not copied in: the image installs it (npm ci)
  const need = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((p) => p !== "node_modules");
  assert.ok(need.includes("docs/frozen/agent-tools.md"));
  for (const p of need) assert.ok(isFile(p), `${p} is in the repository`);
  assert.deepEqual(need.filter((p) => excluded(rules, p)), [], "Dockerfile.dockerignore leaves out files the bundle check needs");
});

test("the image carries the release's own version: the bake passes the tag as VYRE_VERSION, the Dockerfile sets it in the environment the daemon reads, and the release bakes with its version", () => {
  const dockerfile = fs.readFileSync(path.join(repo, "images/vyred/Dockerfile"), "utf8");
  const bake = fs.readFileSync(path.join(repo, "images/vyred/docker-bake.hcl"), "utf8");
  const release = fs.readFileSync(path.join(repo, ".github/workflows/release.yml"), "utf8");
  assert.match(dockerfile, /^ARG VYRE_VERSION=\S+$/m, "the build takes the version");
  assert.match(dockerfile, /^ENV VYRE_VERSION=\$\{VYRE_VERSION\}/m, "and sets it where host/src/daemon/main.ts and lib/user-agent.ts read it");
  assert.ok(dockerfile.indexOf("ARG VYRE_VERSION") < dockerfile.indexOf("ENV VYRE_VERSION"), "declared before it is used");
  assert.match(bake, /args\s*=\s*\{\s*VYRE_VERSION\s*=\s*"\$\{TAG\}"\s*\}/, "the bake passes the tag it builds");
  assert.match(release, /TAG="\$VERSION" docker buildx bake -f images\/vyred\/docker-bake\.hcl/, "the release bakes with its own version as the tag");
});
