// Measurement, not a test (run by hand on a build box): the time a checkpoint adds and the disk it uses, on a small folder and on a repository-sized one.
//   node modules/engine/tests/checkpoints.measure.ts <files> <bytesPerFile> <turns>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prune, snapshot } from "../checkpoints.ts";
import { spawnSync } from "node:child_process";

const [files, size, turns] = process.argv.slice(2).map(Number) as [number, number, number];
const root = fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), "ckpt-measure-"));
const work = path.join(root, "work");
fs.mkdirSync(work);
/** Random bytes (Web Crypto, in 64 KB pieces): modules do not import node:crypto. */
const randomBytes = (n: number): Buffer => {
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i += 65_536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65_536)));
  return out;
};
const buf = randomBytes(Math.max(size, 1));
for (let i = 0; i < files; i++) {
  const d = path.join(work, `d${i % 200}`, `s${i % 37}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, `f${i}.bin`),
    size > 0 ? Buffer.concat([Buffer.from(`file ${i}\n`), buf.subarray(0, size - (i % 7))]) : "",
  );
}
const gitDir = path.join(root, "store.git");
const du = (p: string): number =>
  Number(spawnSync("du", ["-sk", p], { encoding: "utf8" }).stdout.split("\t")[0]) * 1024;
const ms: number[] = [];
let firstBytes = 0;
for (let t = 0; t < turns; t++) {
  // each turn the agent changes a few files and adds one
  for (let k = 0; k < 5; k++)
    fs.writeFileSync(
      path.join(work, `d${k}`, `s${k}`, `f${k}.bin`),
      randomBytes(Math.max(size, 100)).subarray(0, Math.max(size, 100)),
    );
  fs.writeFileSync(path.join(work, `new-${t}.txt`), `turn ${t}\n`);
  const t0 = process.hrtime.bigint();
  await snapshot({ gitDir, workDir: work, label: `turn t${t}`, now: 1_700_000_000_000 + t });
  ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
  if (t === 0) firstBytes = du(gitDir);
  await prune({ gitDir, workDir: work, now: 1_700_000_000_000 + t }); // what the turn does after its point: keep the last 30
}
const sorted = [...ms].sort((a, b) => a - b);
console.log(
  JSON.stringify({
    files,
    bytesPerFile: size,
    turns,
    folderBytes: du(work),
    firstMs: Math.round(ms[0]!),
    laterMedianMs: Math.round(sorted[Math.floor(sorted.length / 2)]!),
    laterMaxMs: Math.round(sorted[sorted.length - 1]!),
    storeBytesAfter: du(gitDir),
    storeBytesAfterFirst: firstBytes,
  }),
);
fs.rmSync(root, { recursive: true, force: true });
