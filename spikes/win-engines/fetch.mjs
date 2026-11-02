// Host: download a pinned engine build (.exe.zst), check its SHA-256, unpack it. argv: url sha256 out
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
const [url, sha, out] = process.argv.slice(2);
const r = await fetch(url);
if (!r.ok) throw new Error(`${url} answered ${r.status}`);
const buf = Buffer.from(await r.arrayBuffer());
const got = crypto.createHash("sha256").update(buf).digest("hex");
if (got !== sha) throw new Error(`sha mismatch ${got}`);
fs.writeFileSync(out, zlib.zstdDecompressSync(buf));
console.log(`fetched ${out} ${fs.statSync(out).size}`);
