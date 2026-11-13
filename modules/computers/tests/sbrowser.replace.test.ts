// Replacing the Space browser's container of an earlier image while people and agents call (13 Nov 2026, B6a: the owner's server had just been updated; the person's pane woke the browser, replacing the old
// container, and the agent's first open ten seconds later failed with internal.unexpected after 1.1 s). Every Engine call of ensureUp can fail in a way the adapter did not expect: a 404 for something that is
// already gone, a 409 for something that already exists, a plain error. Each is either tolerated (the thing is in the state the step wanted) or comes out as a typed, retryable ToolError with plain words: never a
// raw error. Two callers that arrive while a replace is under way wait on the one replace.
import test from "node:test";
import assert from "node:assert/strict";
import type { ContainerConfig, DockerApi } from "../../../sandbox/src/docker.ts";
import { createDockerSpaceBrowser } from "../sbrowser/docker.ts";
import { ToolError } from "../handlers/tools/common.ts";

type Step = "containerRunning" | "imageExists" | "containerStop" | "containerRemove" | "containerCreate" | "containerStart";
type Flavour = "404" | "409" | "409 running" | "already started" | "plain";
const FAILS: Record<Flavour, () => Error> = {
  "404": () => new Error("Docker 404: No such container: vyre-sbrowser"),
  "409": () => new Error("Docker 409: conflict: removal of container vyre-sbrowser is already in progress"),
  "409 running": () => new Error("Docker 409: conflict: You cannot remove a running container vyre-sbrowser. Stop the container before attempting removal or force remove"),
  "already started": () => new Error("Docker 304: container already started"),
  plain: () => new Error("socket hang up"),
};

/** A scripted Engine whose container is of an earlier image; `fail` makes one step fail (once, or always) with one flavour. */
function engine(fail?: { step: Step; flavour: Flavour; times?: number }, o: { running?: boolean } = {}) {
  let running = o.running !== false;
  let exists = true;
  let image = "sha256:old";
  let createdAt = "2026-11-01T00:00:00Z";
  const calls: string[] = [];
  let left = fail?.times ?? 1;
  const hit = (step: Step): void => { if (fail && fail.step === step && left > 0) { left--; throw FAILS[fail.flavour](); } };
  const api: DockerApi = {
    async ping() { return true; },
    async imageExists() { hit("imageExists"); return true; },
    async networkCreate() { throw new Error("unused"); }, async networkRemove() { throw new Error("unused"); },
    async containerCreate(name, _c: ContainerConfig) { calls.push("create"); hit("containerCreate"); await Promise.resolve(); exists = true; image = "sha256:new"; createdAt = new Date().toISOString(); return `id-${name}`; },
    async containerStart() { calls.push("start"); if (fail?.flavour === "already started") running = true; hit("containerStart"); await Promise.resolve(); running = true; },
    async containerStop() { calls.push("stop"); hit("containerStop"); running = false; },
    async containerRemove() { calls.push("remove"); hit("containerRemove"); await Promise.resolve(); exists = false; running = false; },
    async containerRunning() { hit("containerRunning"); return running && exists; },
    async exec(_n, a) { const action = String(a.cmd[1]); if (!running) return { exitCode: 1, stdout: "", stderr: "browserd is not up yet" }; return { exitCode: 0, stdout: `${JSON.stringify(action === "status" ? { profiles: [] } : { url: "https://example.com/", title: "T", loading: false })}\n`, stderr: "" }; },
    async putArchive() {},
  };
  const body = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));
  const http = async (r: { method: string; path: string }) => {
    if (r.method === "POST" && r.path === "/networks/create") return { status: 201, body: body({}) };
    if (r.path.startsWith("/networks/")) return { status: 200, body: body({ IPAM: { Config: [{ Subnet: "172.30.0.0/16", Gateway: "172.30.0.1" }] } }) };
    if (r.path === "/containers/vyre-sbrowser/json") return exists ? { status: 200, body: body({ Image: image, Created: createdAt, HostConfig: { NetworkMode: "old" }, Config: { Env: [] } }) } : { status: 404, body: body({}) };
    if (r.path.includes("sha256%3Aold")) return { status: 404, body: body({}) };
    if (r.path.startsWith("/images/")) return { status: 200, body: body({ Id: "sha256:new", Created: "2026-11-12T00:00:00Z" }) };
    return { status: 404, body: body({}) };
  };
  return { api, http, calls, get running() { return running; }, get image() { return image; } };
}
const make = (e: ReturnType<typeof engine>) => createDockerSpaceBrowser({ api: e.api, http: e.http as never, runner: {} as never, user: { uid: 10001, gid: 10001 }, sleep: async () => {}, startTimeoutMs: 2000, recheckMs: 0 } as never);
const one = (sb: ReturnType<typeof make>) => sb.tool({ profileId: "agt_dex", tool: "chrome_state", args: {}, timeoutMs: 1000 });

test("the replace itself works: the old container is stopped, removed, made again and started, and the call answers", async () => {
  const e = engine();
  assert.equal((await one(make(e)) as { title?: string }).title, "T");
  assert.deepEqual(e.calls, ["stop", "remove", "create", "start"]);
});

const TOLERATED: Array<[Step, Flavour]> = [["containerRemove", "404"], ["containerRemove", "409"], ["containerStop", "404"], ["containerStop", "plain"], ["containerCreate", "409"], ["containerStart", "already started"]];
for (const [step, flavour] of TOLERATED) {
  test(`${step} answering "${flavour}" during a replace is the state the step wanted: the call goes on and answers`, async () => {
    const e = engine({ step, flavour });
    assert.equal((await one(make(e)) as { title?: string }).title, "T");
  });
}

const TYPED: Array<[Step, Flavour]> = [["containerRunning", "plain"], ["imageExists", "plain"], ["containerRemove", "plain"], ["containerCreate", "plain"], ["containerCreate", "404"], ["containerStart", "plain"], ["containerStart", "404"]];
for (const [step, flavour] of TYPED) {
  test(`${step} failing with "${flavour}" is a typed, retryable error with words, never a raw error; the next call tries again and answers`, async () => {
    const e = engine({ step, flavour });
    const sb = make(e);
    const err = await one(sb).then(() => null, (x: unknown) => x);
    assert.ok(err instanceof ToolError, `a ToolError, not ${String((err as Error)?.constructor?.name)}: ${String((err as Error)?.message)}`);
    assert.equal((err as ToolError).code, "unavailable");
    assert.match((err as ToolError).message, /Space browser/);
    assert.match((err as ToolError).message, /tried again|try again/i);
    assert.equal((await one(sb) as { title?: string }).title, "T", "the failure was one call's; the next one goes through");
  });
}

test("two callers that arrive while a replace is under way wait on the one replace: one stop, one remove, one create, one start, both answer", async () => {
  const e = engine();
  const sb = make(e);
  const [a, b] = await Promise.all([one(sb), (async () => { await Promise.resolve(); return one(sb); })()]);
  assert.equal((a as { title?: string }).title, "T");
  assert.equal((b as { title?: string }).title, "T");
  assert.deepEqual(e.calls, ["stop", "remove", "create", "start"]);
});

test("a container of the earlier image that is stopped is replaced the same way", async () => {
  const e = engine(undefined, { running: false });
  assert.equal((await one(make(e)) as { title?: string }).title, "T");
  assert.deepEqual(e.calls, ["stop", "remove", "create", "start"]);
});

// A 409 on remove that says the container still runs is not "gone": it is a failure, and the old container must never be taken for the new one.
test("a stop that fails and a remove refused with 409 (the old container still runs) is a typed error, never a success on the old browser; the next call replaces it", async () => {
  const e = engine({ step: "containerStop", flavour: "plain" });
  // the remove refuses the first time because the container still runs
  const real = e.api.containerRemove.bind(e.api);
  let refused = false;
  e.api.containerRemove = async (n: string) => { if (!refused) { refused = true; throw FAILS["409 running"](); } return real(n); };
  const sb = make(e);
  const err = await one(sb).then(() => null, (x: unknown) => x);
  assert.ok(err instanceof ToolError && err.code === "unavailable", `a typed error: ${String((err as Error)?.message)}`);
  assert.match((err as ToolError).message, /could not remove the container of the earlier release/);
  assert.doesNotMatch((err as ToolError).message, /Docker|409|conflict|cannot remove a running/, "plain words, none of the daemon's text");
  assert.equal(e.image, "sha256:old", "the old container is still the one there");
  assert.equal((await one(sb) as { title?: string }).title, "T");
  assert.equal(e.image, "sha256:new", "the next call replaced it");
});

test("a create refused with 409 while the old container is still there does not make the old browser current: the call fails, and the next call replaces it", async () => {
  const e = engine({ step: "containerCreate", flavour: "409" });
  // the old container survives the remove (something else holds the name)
  const realRemove = e.api.containerRemove.bind(e.api);
  let keep = true;
  e.api.containerRemove = async (n: string) => { if (keep) { keep = false; return; } return realRemove(n); };
  const sb = make(e);
  const err = await one(sb).then(() => null, (x: unknown) => x);
  assert.ok(err instanceof ToolError, `a typed error, not an answer from the old browser: ${String((err as Error)?.message)}`);
  assert.match((err as ToolError).message, /could not replace its container of the earlier release/);
  assert.equal(e.image, "sha256:old");
  assert.equal((await one(sb) as { title?: string }).title, "T", "the next call replaces it");
  assert.equal(e.image, "sha256:new", "and from then on the container is of this release");
  const calls = e.calls.length;
  await one(sb);
  assert.equal(e.calls.length, calls, "a container of this release is current: nothing more is done");
});

test("the Docker text never reaches the agent", async () => {
  const e = engine({ step: "containerCreate", flavour: "plain" });
  const err = await one(make(e)).then(() => null, (x: unknown) => x);
  assert.ok(err instanceof ToolError);
  assert.doesNotMatch((err as ToolError).message, /socket hang up/);
});
