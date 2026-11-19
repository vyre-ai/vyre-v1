// The Word to PDF converter image (lane r42-docs): a fake Docker engine answers the Engine API. Proves the state machine (none, idle, pulling, ready, failed), that a conversion never waits on a fetch,
// that one container is made per conversion with no network and removed whatever happened, that a failure is retried only after its wait, and that the archive format round-trips.
import test from "node:test";
import assert from "node:assert/strict";
import { ConverterUnavailable, createDocConverter, tarOne, untarFirst } from "./doc-converter.ts";
import type { Engine, EngineRequest } from "./doc-converter.ts";

const j = (o: unknown) => new Uint8Array(Buffer.from(JSON.stringify(o)));
const enc = (s: string) => new Uint8Array(Buffer.from(s));

function fakeEngine(o: { image?: "there" | "absent" | "arrives"; code?: number; noPdf?: boolean; pullFails?: boolean; down?: boolean } = {}) {
  const log: EngineRequest[] = [];
  let have = o.image === "there";
  let containers = 0;
  let released: () => void = () => undefined;
  const gate = new Promise<void>((r) => (released = r));
  const engine: Engine = async (req) => {
    log.push(req);
    if (o.down) throw new Error("connect ENOENT");
    if (req.method === "GET" && req.path.startsWith("/images/")) return { status: have ? 200 : 404, body: enc("{}") };
    if (req.path === "/images/create") {
      await gate;
      if (o.pullFails) return { status: 500, body: enc("registry unreachable") };
      have = true;
      return { status: 200, body: enc("") };
    }
    if (req.path === "/containers/create") return { status: 201, body: j({ Id: `c${++containers}` }) };
    if (req.method === "PUT") return { status: 200, body: enc("") };
    if (req.path.endsWith("/start")) return { status: 204, body: enc("") };
    if (req.path.endsWith("/wait")) return { status: 200, body: j({ StatusCode: o.code ?? 0 }) };
    if (req.method === "GET" && req.path.endsWith("/archive")) return o.noPdf ? { status: 404, body: enc("") } : { status: 200, body: tarOne("in.pdf", enc("%PDF-1.7 exact")) };
    if (req.method === "DELETE") return { status: 204, body: enc("") };
    return { status: 500, body: enc("unexpected " + req.path) };
  };
  return { engine, log, release: () => released() };
}
const states = () => {
  const seen: string[] = [];
  return { seen, onState: (s: string) => void seen.push(s) };
};

test("the archive format round-trips: one file in, the same bytes out", () => {
  const bytes = new Uint8Array(1500).map((_, i) => i % 251);
  assert.deepEqual(untarFirst(tarOne("in.docx", bytes)), bytes);
  assert.equal(untarFirst(new Uint8Array(1024)), null);
});

test("with the image here a conversion makes one container with no network, copies the Word file in and the PDF out, and removes it", async () => {
  const f = fakeEngine({ image: "there" });
  const c = createDocConverter({ engine: f.engine, image: "ghcr.io/vyre-ai/doc-converter:1.0.0" });
  const pdf = await c.pdf(enc("docx"));
  assert.equal(Buffer.from(pdf).toString(), "%PDF-1.7 exact");
  assert.equal(c.state(), "ready");
  const made = f.log.find((r) => r.path === "/containers/create")!.json as { NetworkDisabled: boolean; HostConfig: Record<string, unknown> };
  assert.equal(made.NetworkDisabled, true);
  assert.deepEqual(made.HostConfig["CapDrop"], ["ALL"]);
  assert.equal(f.log.filter((r) => r.method === "DELETE").length, 1, "the container is removed");
});

test("the first Word file with no image answers pulling at once, the fetch runs on, and the next conversion is exact", async () => {
  const f = fakeEngine({ image: "absent" });
  const s = states();
  const c = createDocConverter({ engine: f.engine, image: "ghcr.io/vyre-ai/doc-converter:1.0.0", onState: s.onState });
  await assert.rejects(c.pdf(enc("docx")), (e: unknown) => e instanceof ConverterUnavailable && e.state === "pulling");
  assert.equal(c.state(), "pulling");
  // a second Word file while it is fetching does not start a second fetch and does not wait
  await assert.rejects(c.pdf(enc("docx")), (e: unknown) => e instanceof ConverterUnavailable && e.state === "pulling");
  assert.equal(f.log.filter((r) => r.path === "/images/create").length, 1);
  f.release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.state(), "ready");
  assert.equal(Buffer.from(await c.pdf(enc("docx"))).toString(), "%PDF-1.7 exact");
  assert.deepEqual(s.seen, ["pulling", "ready"]);
});

test("no Docker engine is the state none and says so; a failed fetch is failed and is tried again only after its wait", async () => {
  const down = createDocConverter({ engine: fakeEngine({ down: true }).engine, image: "x:1" });
  await assert.rejects(down.pdf(enc("d")), (e: unknown) => e instanceof ConverterUnavailable && e.state === "none");
  assert.equal(down.state(), "none");
  let t = 1000;
  const f = fakeEngine({ image: "absent", pullFails: true });
  const c = createDocConverter({ engine: f.engine, image: "ghcr.io/vyre-ai/doc-converter:1", retryMs: 60_000, now: () => t });
  await assert.rejects(c.pdf(enc("d")));
  f.release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.state(), "failed");
  await assert.rejects(c.pdf(enc("d")), (e: unknown) => e instanceof ConverterUnavailable && e.state === "failed");
  assert.equal(f.log.filter((r) => r.path === "/images/create").length, 1, "no retry inside the wait");
  t += 61_000;
  await assert.rejects(c.pdf(enc("d")), (e: unknown) => e instanceof ConverterUnavailable && e.state === "pulling");
  assert.equal(f.log.filter((r) => r.path === "/images/create").length, 2, "tried again after the wait");
});

test("a converter that stops with an error, or leaves no PDF, throws, removes its container and is failed", async () => {
  for (const o of [{ code: 1 }, { noPdf: true }] as const) {
    const f = fakeEngine({ image: "there", ...o });
    const c = createDocConverter({ engine: f.engine, image: "x:1" });
    await assert.rejects(c.pdf(enc("d")));
    assert.equal(c.state(), "failed");
    assert.equal(f.log.filter((r) => r.method === "DELETE").length, 1);
  }
});

