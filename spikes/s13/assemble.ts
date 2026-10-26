// Assemble kernel.wat with wabt (dev dependency, allowlisted) on the machine that runs the tests. The bytes are never committed; the WAT is the source.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const WAT = fileURLToPath(new URL("./kernel.wat", import.meta.url));

interface Wabt { parseWat(name: string, src: string, features: Record<string, boolean>): { toBinary(o: Record<string, unknown>): { buffer: Uint8Array }; destroy(): void } }

export async function assembleKernel(): Promise<Uint8Array> {
  const mod = (await import("wabt")) as unknown as { default: () => Promise<Wabt> };
  const wabt = await mod.default();
  const m = wabt.parseWat("kernel.wat", fs.readFileSync(WAT, "utf8"), { simd: true });
  try {
    return new Uint8Array(m.toBinary({}).buffer);
  } finally {
    m.destroy();
  }
}
