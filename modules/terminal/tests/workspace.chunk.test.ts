// Big bodies over a node's socket (6 Nov): a request body larger than one frame is staged on the node in pieces and then named by the request; an answer larger than one frame is fetched in pieces. The Space's
// remoteDockerHttp talks to the node's real createDockerAsk, which talks to a fake Docker over a unix socket that keeps what it was sent and answers an archive of a size the test chooses.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { CHUNK, createDockerAsk } from "../../../host/src/compute/docker-ask.ts";
import { remoteDockerHttp } from "../fleet.ts";

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const pattern = (n: number): Buffer => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + (i >> 8)) & 255; return b; };

async function rig(o: { answerBytes?: number; maxTotal?: number; now?: () => number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chunk-"));
  const got: Array<{ method: string; url: string; sha: string; bytes: number }> = [];
  const answer = pattern(o.answerBytes ?? 10);
  const fake = http.createServer((q, s) => {
    const chunks: Buffer[] = [];
    q.on("data", (c: Buffer) => chunks.push(c));
    q.on("end", () => {
      const body = Buffer.concat(chunks);
      if (q.url === "/version") { s.writeHead(200); s.end(JSON.stringify({ ApiVersion: "1.47", MinAPIVersion: "1.24" })); return; }
      got.push({ method: q.method ?? "", url: q.url ?? "", sha: sha(body), bytes: body.length });
      s.writeHead(200);
      s.end(/archive/.test(q.url ?? "") && q.method === "GET" ? answer : "");
    });
  });
  await new Promise<void>((r) => fake.listen(path.join(dir, "docker.sock"), r));
  const ask = createDockerAsk({ socket: path.join(dir, "docker.sock"), token: "t", ...(o.maxTotal !== undefined ? { maxTotal: o.maxTotal } : {}), ...(o.now ? { now: o.now } : {}) });
  const frames: Array<Record<string, unknown>> = [];
  const dh = remoteDockerHttp(async (input) => { frames.push(input as Record<string, unknown>); return ask(input); });
  return { dh, ask, got, frames, answer, close: () => { fake.closeAllConnections?.(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("a request body of several frames is staged piece by piece and arrives whole", async (t) => {
  const r = await rig();
  t.after(r.close);
  const body = pattern(CHUNK * 2 + 12_345);
  const res = await r.dh({ method: "PUT", path: "/containers/vyre-ws-x/archive", query: { path: "/home/agent/Vyre" }, body, contentType: "application/x-tar" });
  assert.equal(res.status, 200);
  const put = r.got.at(-1)!;
  assert.deepEqual([put.method, put.bytes, put.sha], ["PUT", body.length, sha(body)], "Docker got every byte, in order");
  assert.equal(r.frames.filter((f) => f["stage"]).length, 3, "three pieces");
  assert.ok(r.frames.every((f) => JSON.stringify(f).length < 3_000_000), "no frame is over what the socket holds");
  assert.equal(r.frames.at(-1)!["bodyB64"], undefined, "the last question carries no body of its own, it names the staged one");
});

test("an answer of several frames is fetched piece by piece and comes back whole; a small one is one frame", async (t) => {
  const r = await rig({ answerBytes: CHUNK * 3 + 777 });
  t.after(r.close);
  const res = await r.dh({ method: "GET", path: "/containers/vyre-ws-x/archive", query: { path: "/home/agent/Vyre/." } });
  assert.deepEqual([res.status, res.body.length, sha(res.body)], [200, r.answer.length, sha(r.answer)]);
  assert.equal(r.frames.filter((f) => f["chunk"]).length, 3);
  const small = await rig({ answerBytes: 100 });
  t.after(small.close);
  const s = await small.dh({ method: "GET", path: "/containers/vyre-ws-x/archive", query: { path: "/p" } });
  assert.equal(s.body.length, 100);
  assert.equal(small.frames.length, 1, "one question");
});

test("a staged body that did not all arrive, or went stale, is refused and is gone", async (t) => {
  let clock = 1_000;
  const r = await rig({ now: () => clock });
  t.after(r.close);
  const id = "0123456789abcdef";
  await r.ask({ method: "PUT", path: "/", stage: { id, index: 0, total: 2 }, bodyB64: Buffer.alloc(10).toString("base64") });
  await assert.rejects(() => r.ask({ method: "PUT", path: "/containers/vyre-ws-x/archive", query: { path: "/p" }, stagedId: id }), /did not all arrive/);
  await assert.rejects(() => r.ask({ method: "PUT", path: "/containers/vyre-ws-x/archive", query: { path: "/p" }, stagedId: id }), /did not all arrive/, "and it is spent");
  const id2 = "fedcba9876543210";
  await r.ask({ method: "PUT", path: "/", stage: { id: id2, index: 0, total: 1 }, bodyB64: Buffer.alloc(10).toString("base64") });
  clock += 121_000;
  await assert.rejects(() => r.ask({ method: "PUT", path: "/containers/vyre-ws-x/archive", query: { path: "/p" }, stagedId: id2 }), /did not all arrive/, "left too long");
  await assert.rejects(() => r.ask({ method: "GET", path: "/", chunk: { id: "00112233445566778899", index: 1 } }), /no longer here/);
});

test("the total is bounded: a body or an answer over the limit is refused, and what waits on the node counts against it", async (t) => {
  const r = await rig({ answerBytes: CHUNK * 2, maxTotal: CHUNK + 100 });
  t.after(r.close);
  await assert.rejects(() => r.dh({ method: "GET", path: "/containers/vyre-ws-x/archive", query: { path: "/p" } }), /too large to bring over the server link/);
  await r.ask({ method: "PUT", path: "/", stage: { id: "aaaaaaaaaaaaaaaa", index: 0, total: 2 }, bodyB64: Buffer.alloc(CHUNK).toString("base64") });
  await assert.rejects(() => r.ask({ method: "PUT", path: "/", stage: { id: "bbbbbbbbbbbbbbbb", index: 0, total: 2 }, bodyB64: Buffer.alloc(CHUNK).toString("base64") }), /too much waiting/);
});

test("a piece fetched twice, or out of range, is refused; the last piece fetched frees the answer", async (t) => {
  const r = await rig({ answerBytes: CHUNK + 5 });
  t.after(r.close);
  const first = await r.ask({ method: "GET", path: "/containers/vyre-ws-x/archive", query: { path: "/p" } }) as { more: { id: string } };
  await assert.rejects(() => r.ask({ method: "GET", path: "/", chunk: { id: first.more.id, index: 5 } }), /no longer here/);
  const piece = await r.ask({ method: "GET", path: "/", chunk: { id: first.more.id, index: 1 } });
  assert.equal(Buffer.from(piece.bodyB64, "base64").length, 5);
  await assert.rejects(() => r.ask({ method: "GET", path: "/", chunk: { id: first.more.id, index: 1 } }), /no longer here/);
});
