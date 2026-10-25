// The HubSpot connector folder (spec 2.10). The platform reads connector.toml; these helpers compile it and replay it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileConnector } from "./compile.ts";
import type { Compiled } from "./compile.ts";

export * from "./compile.ts";
export * from "./sync.ts";
export * from "./replay.ts";
export { parseToml, TomlError } from "./toml.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** connector.toml of this folder, compiled, with its recorded responses read from tests/recorded. */
export function loadHubspot(): Compiled {
  return compileConnector(readFileSync(join(ROOT, "connector.toml"), "utf8"), (rel) => readFileSync(join(ROOT, rel), "utf8"));
}
