// Command line for the release workflow:
//   node scripts/release/cli.ts counter <version>
//   node scripts/release/cli.ts bump <version> | --check
//   node scripts/release/cli.ts lineage <sha> <tag>
//   VYRE_SIGNING_KEY=<pkcs8 pem> node scripts/release/cli.ts pubkey [outfile]    prints the public half (hex) and its key id; with outfile writes {"publicKey","keyId"} for compiling into the servers
//   node scripts/release/cli.ts assets <dir>    writes <channel>.json, <channel>.json.sig (and <channel>-<kind>... for the others) from <dir>/feed.json: the files attached to the GitHub Release
//   VYRE_SIGNING_KEY=<pkcs8 pem> node scripts/release/cli.ts sign <dir> <channel> <pinned-public-key-hex>
//     dir holds releases.json ({ app?, server?, kits?, extension? } of { version, tarball, sha256 }); writes <dir>/feed.json with one signed entry per channel present.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UPDATE_CHANNELS, buildEntries } from "./channels.ts";
import type { FeedEntry, Releases, UpdateChannel } from "./channels.ts";
import { assetsFor } from "./feed.ts";
import { lineage, newestStable } from "./lineage.ts";
import { SIGNING_KEY_ENV, keyId, publicKeyHexOf } from "./sign.ts";
import { bump, releaseCounter, versionProblems } from "./version.ts";

const run = (a: string[]): string => execFileSync(a[0] ?? "", a.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const isAncestor = (x: string, y: string): boolean => { try { execFileSync("git", ["merge-base", "--is-ancestor", x, y], { stdio: "ignore" }); return true; } catch { return false; } };

export function main(argv: string[]): number {
  const [cmd, a, b, c] = argv;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  try {
    switch (cmd) {
      case "counter": console.log(releaseCounter(a ?? "")); return 0;
      case "bump": {
        if (a === "--check") { const p = versionProblems(root); for (const l of p) console.error(`release: ${l}`); return p.length > 0 ? 1 : 0; }
        if (a === undefined) { console.error("usage: bump <version> | --check"); return 2; }
        const r = bump(root, a); console.log(`release: ${r.from ?? "none"} -> ${r.to}`); return 0;
      }
      case "lineage": {
        if (a === undefined || b === undefined) { console.error("usage: lineage <sha> <tag>"); return 2; }
        const published = run(["gh", "release", "list", "--limit", "100", "--json", "tagName,isPrerelease,isDraft", "-q", ".[]|select(.isPrerelease==false and .isDraft==false)|.tagName"]).split("\n").filter(Boolean);
        const prev = newestStable(published.filter((t) => t !== b));
        const problems = lineage({ tag: b, prev, prevIsAncestor: prev !== null && isAncestor(`refs/tags/${prev}`, a), onHotfixBranch: isAncestor(a, `origin/hotfix/${b}`) });
        for (const p of problems) console.error(`release-lineage: ${p}`);
        return problems.length > 0 ? 1 : 0;
      }
      case "pubkey": {
        const pem = process.env[SIGNING_KEY_ENV] ?? "";
        if (pem === "") { console.error(`${SIGNING_KEY_ENV} is only set in the release environment`); return 2; }
        const publicKey = publicKeyHexOf(pem);
        if (a !== undefined) fs.writeFileSync(a, `${JSON.stringify({ publicKey, keyId: keyId(publicKey) }, null, 2)}\n`);
        console.log(`${publicKey} ${keyId(publicKey)}`);
        return 0;
      }
      case "sign": {
        const pem = process.env[SIGNING_KEY_ENV] ?? "";
        if (a === undefined || b === undefined || c === undefined || pem === "") { console.error(`usage: ${SIGNING_KEY_ENV}=<pkcs8 pem> sign <dir> <channel> <pinned-public-key-hex>`); return 2; }
        if (!(UPDATE_CHANNELS as readonly string[]).includes(b)) { console.error(`release: channel must be one of ${UPDATE_CHANNELS.join(", ")}`); return 2; }
        const releases = JSON.parse(fs.readFileSync(path.join(a, "releases.json"), "utf8")) as Releases;
        const entries = buildEntries({ channel: b as UpdateChannel, releases, privateKeyPem: pem, pinnedPublicKey: c });
        fs.writeFileSync(path.join(a, "feed.json"), JSON.stringify(entries));
        console.log(`release: signed ${entries.map((e) => e.kind).join(", ") || "nothing"}`);
        return 0;
      }
      case "assets": {
        if (a === undefined) { console.error("usage: assets <dir>   (writes the release assets from <dir>/feed.json)"); return 2; }
        const entries = JSON.parse(fs.readFileSync(path.join(a, "feed.json"), "utf8")) as FeedEntry[];
        const names = entries.flatMap(assetsFor).map((f) => { fs.writeFileSync(path.join(a, f.name), f.content); return f.name; });
        console.log(`release: wrote ${names.join(", ")}`);
        return 0;
      }
      default: console.error("usage: counter | bump | lineage | pubkey | sign | assets"); return 2;
    }
  } catch (e) { console.error(`release: ${e instanceof Error ? e.message : "failed"}`); return 1; }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
