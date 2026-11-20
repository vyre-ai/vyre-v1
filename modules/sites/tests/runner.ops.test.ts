// The runner calls site operations use, against a stand-in socket that answers as Docker does (r42-sites-run): "not found" is not "the engine failed", and a file is copied out in parts under a cap.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { dockerRunner } from "../handlers/runner.ts";
import { tarFiles } from "../handlers/tar.ts";

async function engine(
  t: { after(f: () => void): void },
  handle: (q: http.IncomingMessage, s: http.ServerResponse) => void,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-site-ops-"));
  const sock = path.join(dir, "runner.sock");
  const server = http.createServer((q, s) => {
    q.resume();
    q.on("end", () => handle(q, s));
  });
  await new Promise<void>((r) => server.listen(sock, r));
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dockerRunner({ socketPath: sock, token: () => "t" });
}

test("stateStrict: a container that is not there is null; a failing engine throws and is never read as gone", async (t) => {
  let status = 200;
  const r = await engine(t, (_q, s) => {
    s.writeHead(status);
    s.end(JSON.stringify(status === 200 ? { State: { Running: true, ExitCode: 0 } } : { message: "x" }));
  });
  assert.deepEqual(await r.stateStrict("c1"), { running: true, exitCode: 0 });
  status = 404;
  assert.equal(await r.stateStrict("c1"), null);
  for (const bad of [500, 502, 429, 503]) {
    status = bad;
    await assert.rejects(() => r.stateStrict("c1"), /engine answered/, String(bad));
  }
});

test("getFileParts hands the file over in parts of the size asked, in order, and returns its size", async (t) => {
  const data = new Uint8Array(1000).map((_, i) => i % 251);
  const tar = tarFiles([{ path: "vyre-backup.gz", data }]);
  const r = await engine(t, (_q, s) => {
    s.writeHead(200);
    s.end(Buffer.from(tar));
  });
  const parts: number[] = [];
  const joined: number[] = [];
  const total = await r.getFileParts("c1", "/tmp/vyre-backup.gz", 10_000, 300, async (p) => {
    parts.push(p.length);
    joined.push(...p);
  });
  assert.equal(total, 1000);
  assert.deepEqual(parts, [300, 300, 300, 100]);
  assert.deepEqual(joined, Array.from(data));
});

test("getFileParts refuses a file over the cap at its header, before handing over any part", async (t) => {
  const tar = tarFiles([{ path: "x", data: new Uint8Array(5000) }]);
  const r = await engine(t, (_q, s) => {
    s.writeHead(200);
    s.end(Buffer.from(tar));
  });
  const parts: number[] = [];
  await assert.rejects(
    () => r.getFileParts("c1", "/tmp/vyre-backup.gz", 1000, 300, async (p) => void parts.push(p.length)),
    (e: unknown) => (e as Error).name === "TooBig",
  );
  assert.deepEqual(parts, []);
});

test("getFileParts waits for each part to be taken before the next arrives, and a part that fails stops the copy", async (t) => {
  const tar = tarFiles([{ path: "x", data: new Uint8Array(900) }]);
  const r = await engine(t, (_q, s) => {
    s.writeHead(200);
    s.end(Buffer.from(tar));
  });
  let live = 0;
  let peak = 0;
  await r.getFileParts("c1", "/tmp/vyre-backup.gz", 10_000, 300, async () => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((x) => setTimeout(x, 10));
    live--;
  });
  assert.equal(peak, 1, "one part at a time");
  let n = 0;
  await assert.rejects(
    () =>
      r.getFileParts("c1", "/tmp/vyre-backup.gz", 10_000, 300, async () => {
        if (++n === 2) throw new Error("disk full");
      }),
    /disk full/,
  );
});

test("getFileParts turns an engine refusal into one plain sentence", async (t) => {
  const r = await engine(t, (_q, s) => {
    s.writeHead(403);
    s.end(JSON.stringify({ message: "Refused by the sites runner" }));
  });
  await assert.rejects(
    () => r.getFileParts("c1", "/etc/passwd", 100, 10, async () => undefined),
    /Could not copy the file out: Refused/,
  );
});
