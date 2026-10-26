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
import { assetsFor, feedBase } from "./feed.ts";
import { APP_TARBALL, EXTENSION_ZIP, KITS_TARBALL, packExtension, packFolder, packServer, releasesFrom } from "./pack.ts";
import type { ImageKey } from "./pack.ts";
import { GithubReleases, publishRelease, updateRolling } from "./publish.ts";
import { smokeRelease } from "./smoke.ts";
import { lineage, newestStable } from "./lineage.ts";
import { SIGNING_KEY_ENV, keyId, publicKeyHexOf } from "./sign.ts";
import { bump, channelOfVersion, releaseCounter, tagVersion, versionProblems } from "./version.ts";

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
      case "tag": {
        // tag <tag>: the version the tag names and its channel; refuses a tag that is not a release version or does not equal package.json
        const v = tagVersion(a ?? "");
        if (v === null) { console.error(`release: ${a ?? ""} is not a release tag (v1.2.3, v1.2.3-rc.1)`); return 1; }
        const pkg = (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string }).version;
        if (pkg !== v) { console.error(`release: the tag says ${v} and package.json says ${pkg ?? "nothing"}; bump first`); return 1; }
        console.log(`${v} ${channelOfVersion(v)}`);
        return 0;
      }
      case "pack": {
        // pack <dir> <version>: server (needs IMAGE_* env), app web export (APP_DIST), extension and kits, into <dir>; each only when its input is given
        if (a === undefined || b === undefined) { console.error("usage: pack <dir> <version>   (env: VYRE_IMAGE[, VYRE_AGENT_IMAGE, VYRE_SANDBOX_IMAGE] APP_DIST)"); return 2; }
        fs.mkdirSync(a, { recursive: true });
        const images: Partial<Record<ImageKey, string>> = {};
        for (const k of ["VYRE_IMAGE", "VYRE_AGENT_IMAGE", "VYRE_SANDBOX_IMAGE"] as const) { const v = process.env[k]; if (v) images[k] = v; }
        const made: string[] = [];
        if (images.VYRE_IMAGE) { packServer({ root, outDir: a, version: b, images }); made.push("vyre.tgz"); }
        const dist = process.env["APP_DIST"];
        if (dist) { packFolder({ dir: dist, outFile: path.join(a, APP_TARBALL), topName: "app-web" }); made.push(APP_TARBALL); }
        packExtension({ dir: path.join(root, "apps/chrome"), outFile: path.join(a, EXTENSION_ZIP) }); made.push(EXTENSION_ZIP);
        packFolder({ dir: path.join(root, "kits"), outFile: path.join(a, KITS_TARBALL), topName: "kits" }); made.push(KITS_TARBALL);
        fs.writeFileSync(path.join(a, "releases.json"), JSON.stringify(releasesFrom({ version: b, dir: a })));
        console.log(`release: packed ${made.join(", ")}`);
        return 0;
      }
      case "feed-base": {
        if (!(UPDATE_CHANNELS as readonly string[]).includes(a ?? "")) { console.error("usage: feed-base <stable|beta|nightly>"); return 2; }
        console.log(feedBase(a as UpdateChannel));
        return 0;
      }
      case "assets": {
        if (a === undefined) { console.error("usage: assets <dir>   (writes the release assets from <dir>/feed.json)"); return 2; }
        const entries = JSON.parse(fs.readFileSync(path.join(a, "feed.json"), "utf8")) as FeedEntry[];
        const names = entries.flatMap(assetsFor).map((f) => { fs.writeFileSync(path.join(a, f.name), f.content); return f.name; });
        console.log(`release: wrote ${names.join(", ")}`);
        return 0;
      }
      default: console.error("usage: counter | bump | tag | lineage | pack | pubkey | sign | assets | feed-base | smoke"); return 2;
    }
  } catch (e) { console.error(`release: ${e instanceof Error ? e.message : "failed"}`); return 1; }
}

/** publish <dir> | rolling <dir> <channel> | unpublish <tag>: GitHub Releases over the REST API (repo from GITHUB_REPOSITORY, token from GH_TOKEN, tag from TAG). */
export async function publishMain(argv: string[]): Promise<number> {
  const [cmd, a, b] = argv;
  const repo = process.env["GITHUB_REPOSITORY"] ?? "", token = process.env["GH_TOKEN"] ?? "", tag = process.env["TAG"] ?? "";
  if (repo === "" || token === "") { console.error("release: GITHUB_REPOSITORY and GH_TOKEN are needed"); return 2; }
  try {
    if (cmd === "publish" && a) {
      const channel = process.env["CHANNEL"] ?? "stable";
      const r = await publishRelease({ repo, token, tag, dir: a, prerelease: channel !== "stable", notes: `Release ${tag}. Signed manifests: ${channel}.json and ${channel}.json.sig.` });
      console.log(`release: attached ${r.attached.join(", ")} to ${tag}`);
      return 0;
    }
    if (cmd === "rolling" && a && b) { const r = await updateRolling({ repo, token, dir: a, channel: b }); console.log(`release: channel-${b} now has ${r.attached.join(", ")}`); return 0; }
    if (cmd === "unpublish" && a) { console.log((await new GithubReleases(repo, token).remove(a)) ? `release: deleted the release of ${a}` : `release: no release of ${a}`); return 0; }
    console.error("usage: publish <dir> | rolling <dir> <channel> | unpublish <tag>"); return 2;
  } catch (e) { console.error(`release: ${e instanceof Error ? e.message : "failed"}`); return 1; }
}

/** smoke <base> <stable|beta|nightly> <public-key-hex> <version>: asynchronous, so it is not a case of main(). */
export async function smokeMain(argv: string[]): Promise<number> {
  const [, base, channel, key, version] = argv;
  if (!base || !channel || !key || !version || !(UPDATE_CHANNELS as readonly string[]).includes(channel)) { console.error("usage: smoke <base> <stable|beta|nightly> <public-key-hex> <version>"); return 2; }
  try {
    const r = await smokeRelease({ base, channel: channel as UpdateChannel, publicKeyHex: key, version });
    for (const s of r.steps) console.log(`${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
    return r.ok ? 0 : 1;
  } catch (e) { console.error(`release: ${e instanceof Error ? e.message : "smoke failed"}`); return 1; }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args[0] === "smoke") void smokeMain(args).then((code) => process.exit(code));
  else if (args[0] === "publish" || args[0] === "rolling" || args[0] === "unpublish") void publishMain(args).then((code) => process.exit(code));
  else process.exit(main(args));
}
