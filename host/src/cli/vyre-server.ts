// bin: `vyre-server` (start, stop, status, logs, doctor; the same as `vyre server ...`)
import { main } from "./index.ts";
import { processIo } from "./io.ts";

process.exitCode = await main(process.argv.slice(2), processIo(), "vyre-server");
