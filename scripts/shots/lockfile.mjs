#!/usr/bin/env node
// Resolves the dependency tree into package-lock.json without installing anything (CI only; the Mac never runs npm).
// The shots workflow runs this on dispatch (or a commit message with [lockfile]) and uploads the file as the `lockfile` artifact.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
execSync("npm install --package-lock-only --ignore-scripts --no-audit --no-fund", { cwd: REPO, stdio: "inherit" });
