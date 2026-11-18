// The export's text files, compressed once at build time (brotli at its best level and gzip) beside each file as name.br and name.gz, so the server hands a browser the finished bytes instead of making them
// per request (host/src/routes/app-files.ts serves them to a browser that accepts the encoding). Run by scripts/app-export.mjs after the export.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const TEXT = /\.(html|js|css|json|webmanifest|svg|txt|map)$/;
const MIN = 1024;

/** Compress every text file of dir that is at least 1 KB and where compressing it saves bytes; returns what was written. */
export function precompress(dir) {
  const out = { files: 0, raw: 0, br: 0, gz: 0 };
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (TEXT.test(e.name) && e.isFile()) {
        const raw = fs.readFileSync(p);
        if (raw.length < MIN) continue;
        const br = zlib.brotliCompressSync(raw, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
        });
        const gz = zlib.gzipSync(raw, { level: 9 });
        if (br.length >= raw.length || gz.length >= raw.length) continue;
        fs.writeFileSync(`${p}.br`, br);
        fs.writeFileSync(`${p}.gz`, gz);
        out.files += 1;
        out.raw += raw.length;
        out.br += br.length;
        out.gz += gz.length;
      }
    }
  };
  walk(dir);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = precompress(path.resolve(process.argv[2] ?? "apps/app/dist"));
  console.log(`precompress: ${r.files} files, ${(r.raw / 1048576).toFixed(1)} MB raw, ${(r.br / 1048576).toFixed(1)} MB brotli, ${(r.gz / 1048576).toFixed(1)} MB gzip`);
}
