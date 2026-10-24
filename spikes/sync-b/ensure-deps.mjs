// The workspace does not install spike dependencies; install yjs next to the spike on first use (CI has network).
import fs from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
if (!fs.existsSync(dir + "node_modules/yjs")) execSync("npm install --no-audit --no-fund --no-package-lock --ignore-scripts", { cwd: dir, stdio: "inherit" });
