// The vendored fflate (apps/app/public/vendor/fflate/fflate.js, a UMD for the browser) loaded in node for the tests, the way a page loads it: as a script that sets a global.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../public/vendor/fflate/fflate.js", import.meta.url), "utf8");
// run in this realm (a new vm context would give it another Uint8Array, and fflate tells a file from a folder by instanceof)
const ctx: Record<string, unknown> = {};
new Function("self", "module", "exports", src)(ctx);
export const fflate = ctx["fflate"] as {
  unzipSync(d: Uint8Array, o?: { filter?: (f: { name: string; size: number; originalSize: number; compression: number }) => boolean }): Record<string, Uint8Array>;
  zipSync(d: Record<string, Uint8Array | [Uint8Array, { level?: number; mtime?: number }]>, o?: { level?: number }): Uint8Array;
};
