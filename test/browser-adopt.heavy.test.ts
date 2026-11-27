// @heavy docker
// A Space's own browser container takes the saved sign-ins of its profiles from the old shared one (rc.44, owner rule: a saved sign-in is never lost in an update), on a real Docker host with the real image.
// An agent signs in (a persistent cookie on a page in the old container, its Chromium closed so the browser writes it), the profile is marked as this Space's, then the Space's own container (own name, own volume,
// the old volume mounted read-only) takes over: the same site is still signed in for that agent in the new container, the old volume is byte for byte as it was, the old container is stopped and not removed,
// and a profile that belongs to another Space is not in the new volume. Runs only with VYRE_HEAVY_DOCKER=1 and VYRE_SPACE_BROWSER_IMAGE (an image already built).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createDockerApi, unixSocketHttp } from "../sandbox/src/docker.ts";
import { createDockerSpaceBrowser } from "../modules/computers/sbrowser/docker.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const IMAGE = process.env["VYRE_SPACE_BROWSER_IMAGE"];
const skip: string | false =
  ON && IMAGE ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_SPACE_BROWSER_IMAGE (a built image)";

const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const OLD = `vyre-sbrowser-test-old${suffix}`;
const NEW = `vyre-sbrowser-test-new${suffix}`;
const SPACE = "spc_adopt_one";
const AGENT = "agt_signedin";
const OTHER = "agt_otherspace";
const http = unixSocketHttp();
const api = createDockerApi(http);

function docker(args: string[], timeoutMs = 120_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as unknown as { code?: number }).code ?? 1) : 0, out: `${stdout}\n${stderr}` }),
    );
  });
}
/** Every file of a volume with its checksum, read without writing (the volume is mounted read-only in a throwaway container of the same image). */
async function fingerprint(volume: string): Promise<string> {
  const r = await docker([
    "run",
    "--rm",
    "-u",
    "0",
    "--entrypoint",
    "sh",
    "-v",
    `${volume}:/d:ro`,
    IMAGE!,
    "-c",
    "cd /d && find . -type f ! -name 'Singleton*' -print0 | sort -z | xargs -0 -r sha256sum",
  ]);
  assert.equal(r.code, 0, r.out);
  return r.out;
}

test(
  "the Space's own container has the agent's saved sign-in from the old shared one; the old volume is untouched",
  { skip, timeout: 600_000 },
  async (t) => {
    t.after(async () => {
      await docker(["rm", "-f", "-v", OLD, NEW]);
      await docker(["volume", "rm", "-f", `${OLD}-data`, `${NEW}-data`]);
      await docker(["network", "rm", `${OLD}net`, `${NEW}net`]);
    });
    const make = (name: string, adopt?: { space: string; all: boolean; from?: string }) =>
      createDockerSpaceBrowser({
        api,
        http,
        name,
        image: IMAGE!,
        user: { uid: 10001, gid: 10001 },
        startTimeoutMs: 90_000,
        ...(adopt ? { adopt } : {}),
      });

    // 1. the old shared container: an agent signs in on a page (a persistent cookie), another Space's agent has a profile too
    const old = make(OLD);
    for (const id of [AGENT, OTHER]) {
      await old.tool({
        profileId: id,
        tool: "chrome_open",
        args: { url: "http://127.0.0.1:7004/" },
        timeoutMs: 60_000,
      });
      await old.tool({
        profileId: id,
        tool: "chrome_eval",
        args: { expression: `document.cookie = 'signed_in=${id}; max-age=31536000; path=/'; document.cookie` },
        timeoutMs: 30_000,
      });
    }
    assert.ok(
      (await old.sessions(AGENT)).some((s) => s.site.includes("127.0.0.1")),
      "signed in on the old container",
    );
    // closing the profile's Chromium makes it write its cookies to disk
    await old.stop(AGENT);
    await old.stop(OTHER);
    // the proof of whose they are: this Space's profile is marked with it, the other is marked with another Space
    assert.equal(await old.markSpace!(SPACE, [AGENT]), 1);
    assert.equal(await old.markSpace!("spc_adopt_two", [OTHER]), 1);
    await docker(["stop", "-t", "10", OLD]);
    const before = await fingerprint(`${OLD}-data`);
    assert.match(before, /Cookies/, "the old volume holds the agent's cookie file");

    // 2. the Space's own container: its own name and volume, the old volume read-only, the first call waits for the copy
    const own = make(NEW, { space: SPACE, all: false, from: OLD });
    const sessions = await own.sessions(AGENT);
    assert.ok(
      sessions.some((s) => s.site.includes("127.0.0.1")),
      `the same site is still signed in for that agent in the Space's own container: ${JSON.stringify(sessions)}`,
    );
    const cookie = await own.tool({
      profileId: AGENT,
      tool: "chrome_open",
      args: { url: "http://127.0.0.1:7004/" },
      timeoutMs: 60_000,
    });
    void cookie;
    const read = (await own.tool({
      profileId: AGENT,
      tool: "chrome_eval",
      args: { expression: "document.cookie" },
      timeoutMs: 30_000,
    })) as {
      result?: unknown;
    };
    assert.match(JSON.stringify(read), new RegExp(`signed_in=${AGENT}`), "and the cookie itself is there");

    // 3. what must not have happened
    const mounts = await docker(["inspect", "-f", "{{range .Mounts}}{{.Name}}:{{.Destination}}:{{.RW}} {{end}}", NEW]);
    assert.match(
      mounts.out,
      new RegExp(`${OLD}-data:/old-data:false`),
      `the old volume is mounted read-only: ${mounts.out}`,
    );
    assert.equal(await fingerprint(`${OLD}-data`), before, "the old volume is byte for byte as it was");
    assert.equal(
      (await docker(["inspect", "-f", "{{.State.Running}}", OLD])).out.trim().startsWith("false"),
      true,
      "the old container is stopped",
    );
    const listing = await docker([
      "run",
      "--rm",
      "-u",
      "0",
      "--entrypoint",
      "ls",
      "-v",
      `${NEW}-data:/d:ro`,
      IMAGE!,
      "/d/profiles",
    ]);
    assert.match(listing.out, new RegExp(AGENT));
    assert.doesNotMatch(listing.out, new RegExp(OTHER), "another Space's profile was not taken");
    const st = (await api.exec(NEW, { cmd: ["/opt/browserd/ctl", "status", "{}"], env: [] })).stdout;
    const report = JSON.parse(st).adopt as { copied: string[]; other: string[]; failed: unknown[] };
    assert.deepEqual(report.copied, [AGENT]);
    assert.deepEqual(report.other, [OTHER]);
    assert.equal(report.failed.length, 0);
  },
);
