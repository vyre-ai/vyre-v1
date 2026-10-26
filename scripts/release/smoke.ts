// The post-publish smoke (P-L11_18): a fresh host reads the published channel the way the installer does, over the network, with nothing from the build. It fetches `<channel>.json` and its
// signature from the release address, verifies the signature with the public key the servers have compiled in, downloads the server tarball, checks its sha256 against the signed manifest and
// looks inside it for the files the installer insists on and the version it names. A failure at any step is the release not being installable, and says which.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SERVER_FILES, sha256File, tarList } from "./pack.ts";
import { verifyManifest } from "./sign.ts";
import { execFileSync } from "node:child_process";

export type SmokeFetch = (url: string) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface SmokeOptions { base: string; channel: "stable" | "beta" | "nightly"; publicKeyHex: string; version: string; fetch?: SmokeFetch }

export interface SmokeResult { ok: boolean; steps: Array<{ step: string; ok: boolean; detail?: string }> }

const realFetch: SmokeFetch = async (url) => {
  const r = await globalThis.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  return { status: r.status, arrayBuffer: () => r.arrayBuffer() };
};

export async function smokeRelease(o: SmokeOptions): Promise<SmokeResult> {
  const get = o.fetch ?? realFetch;
  const base = o.base.replace(/\/?$/, "/");
  const steps: SmokeResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string): boolean => { steps.push({ step: name, ok, ...(detail === undefined ? {} : { detail }) }); return ok; };
  const text = async (name: string): Promise<string | null> => { const r = await get(`${base}${name}`); return r.status === 200 ? Buffer.from(await r.arrayBuffer()).toString("utf8") : null; };

  const manifest = await text(`${o.channel}.json`);
  if (!step("manifest is published", manifest !== null, `${base}${o.channel}.json`) || manifest === null) return { ok: false, steps };
  const sig = await text(`${o.channel}.json.sig`);
  if (!step("signature is published", sig !== null) || sig === null) return { ok: false, steps };
  if (!step("signature verifies with the compiled-in key", verifyManifest(manifest, sig, o.publicKeyHex))) return { ok: false, steps };

  let doc: { v?: number; channel?: string; server?: { version?: string; tarball?: string; sha256?: string } };
  try { doc = JSON.parse(manifest) as typeof doc; } catch { step("manifest reads", false); return { ok: false, steps }; }
  const server = doc.server;
  if (!step("manifest names this version on this channel", doc.v === 1 && doc.channel === o.channel && server?.version === o.version, `${doc.channel} ${server?.version ?? "no version"}`) || !server?.tarball || !server.sha256) return { ok: false, steps };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-"));
  try {
    const r = await get(/^https?:\/\//.test(server.tarball) ? server.tarball : `${base}${server.tarball}`);
    if (!step("server tarball downloads", r.status === 200, `status ${r.status}`)) return { ok: false, steps };
    const file = path.join(tmp, "release.tgz");
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    if (!step("tarball matches the signed sha256", sha256File(file) === server.sha256)) return { ok: false, steps };
    const members = tarList(file);
    const top = members[0]?.split("/")[0] ?? "";
    const missing = SERVER_FILES.filter((f) => !members.includes(`${top}/${f}`));
    if (!step("tarball holds the files the installer needs", missing.length === 0, missing.join(", "))) return { ok: false, steps };
    const version = execFileSync("tar", ["-xzOf", file, `${top}/VERSION`], { encoding: "utf8" }).trim();
    step("VERSION inside matches the manifest", version === server.version, version);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { ok: steps.every((s) => s.ok), steps };
}
