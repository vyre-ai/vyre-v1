#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs, mergeShotIndexes } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const dir = path.resolve(args.dir || "shots-merged");
const expected = Number(args["expect-shards"]);
const names = fs.readdirSync(dir).filter((name) => /^index.*\.md$/.test(name)).sort();
const indexes = names.map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));
fs.writeFileSync(path.join(dir, "index.md"), mergeShotIndexes(indexes, expected));
for (const name of names) if (name !== "index.md") fs.rmSync(path.join(dir, name));
console.log(`merged ${names.length} screenshot shard indexes into ${path.join(dir, "index.md")}`);
