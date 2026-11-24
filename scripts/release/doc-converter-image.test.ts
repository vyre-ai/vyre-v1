// The Word converter image for a release (scripts/release/doc-converter-image.sh): reused by digest when its source is unchanged (no build, no push), built and pushed under the version and its source tag
// when it is not or when the lookup fails, built and proven but never pushed in a practice run. A stub `docker` and a real `jq` stand in for the registry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const D = "sha256:" + "ab".repeat(32);
const NEW = "sha256:" + "cd".repeat(32);

function run(mode: "published" | "absent" | "lookup-fails", dry = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docimg-"));
  const log = path.join(dir, "docker.log");
  fs.writeFileSync(
    path.join(dir, "docker"),
    `#!/usr/bin/env bash
echo "docker $*" >> "${log}"
case "$1 $2 $3" in
  "buildx imagetools inspect")
    case "${mode}" in published) echo '{"digest":"${D}"}'; exit 0;; absent) exit 1;; *) echo 'garbage'; exit 0;; esac ;;
  "buildx imagetools create") exit 0 ;;
  "buildx build "*)
    # the metadata file named by --metadata-file
    for a in "$@"; do if [ "$prev" = "--metadata-file" ]; then echo '{"containerimage.digest":"${NEW}"}' > "$a"; fi; prev="$a"; done; exit 0 ;;
  "build -t "*) exit 0 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  // the proof and retry scripts are the repository's own; the proof is replaced by a stub so no image is needed
  const out = path.join(dir, "out");
  const r = spawnSync("bash", [path.join(REPO, "scripts/release/doc-converter-image.sh"), "1.2.3", String(dry)], {
    cwd: dir,
    env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}`, GITHUB_OUTPUT: out, DOC_CONVERTER_PROOF: "skip" },
    encoding: "utf8",
  });
  const text = (f: string): string => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, log: text(log), output: text(out) };
}

test("an unchanged source reuses the published digest: nothing is built or pushed, the version tag follows it, and the digest is the answer", () => {
  const r = run("published");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.output, new RegExp(`image=ghcr.io/vyre-ai/doc-converter@${D}`));
  assert.doesNotMatch(r.log, /docker build -t|buildx build /);
  assert.match(r.log, /imagetools create -t ghcr.io\/vyre-ai\/doc-converter:1.2.3/);
  assert.match(r.stderr, /unchanged, reusing/);
});

test("a source with no published image, or a lookup that fails, is built for both platforms and pushed under the version and its source tag", () => {
  for (const mode of ["absent", "lookup-fails"] as const) {
    const r = run(mode);
    assert.equal(r.code, 0, r.stderr);
    assert.match(
      r.log,
      /buildx build --platform linux\/amd64,linux\/arm64 .*-t ghcr.io\/vyre-ai\/doc-converter:1.2.3 -t ghcr.io\/vyre-ai\/doc-converter:src-[0-9a-f]{16} --push/,
    );
    assert.match(r.output, new RegExp(`image=ghcr.io/vyre-ai/doc-converter@${NEW}`));
  }
});

test("a practice run builds for this platform and pushes nothing, and hands over no digest", () => {
  const r = run("published", true);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.log, /docker build -t ghcr.io\/vyre-ai\/doc-converter:1.2.3/);
  assert.doesNotMatch(r.log, /buildx|--push/);
  assert.equal(r.output, "");
});
