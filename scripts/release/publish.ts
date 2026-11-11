// Publishing to GitHub Releases through the REST API (P-L11_18). The runners the release jobs land on do not all have the `gh` command, so the workflow calls this instead: it needs only
// node and the job's GITHUB_TOKEN (contents: write). Nothing here signs; it attaches files that are already signed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ApiFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface PublishOptions {
  repo: string;
  token: string;
  tag: string;
  dir: string;
  prerelease: boolean;
  notes: string;
  fetch?: ApiFetch;
}

export interface Asset { id: number; name: string; size?: number; state?: string; digest?: string }
export interface Release { id: number; assets: Asset[]; tag?: string; prerelease?: boolean }

const API = "https://api.github.com";
const UPLOADS = "https://uploads.github.com";

const realFetch: ApiFetch = async (url, init) => {
  const r = await globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(300_000) } as never);
  return { status: r.status, json: () => r.json() as Promise<unknown> };
};

export class GithubReleases {
  // plain fields: node runs this file by stripping types, which does not support constructor parameter properties
  private readonly repo: string;
  private readonly token: string;
  private readonly f: ApiFetch;
  constructor(repo: string, token: string, f?: ApiFetch) { this.repo = repo; this.token = token; this.f = f ?? realFetch; }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...extra };
  }
  private async call(method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await this.f(url, { method, headers: this.headers(extra), ...(body === undefined ? {} : { body: typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body) }) });
    let data: unknown = null;
    try { data = await r.json(); } catch { /* no body */ }
    return { status: r.status, data };
  }

  /** The release for a tag, or null. */
  async byTag(tag: string): Promise<Release | null> {
    const r = await this.call("GET", `${API}/repos/${this.repo}/releases/tags/${encodeURIComponent(tag)}`);
    return r.status === 200 ? r.data : null;
  }

  async create(o: { tag: string; prerelease: boolean; notes: string }): Promise<Release> {
    const r = await this.call("POST", `${API}/repos/${this.repo}/releases`, { tag_name: o.tag, name: o.tag, body: o.notes, prerelease: o.prerelease, draft: false });
    if (r.status !== 201) throw new Error(`could not create the release ${o.tag} (${r.status})`);
    return { id: r.data.id, assets: [] };
  }

  /** A release's pre-release mark. A rerun finds the release a cut run made: it keeps the mark the channel says, so no one sets it by hand. */
  async setPrerelease(id: number, prerelease: boolean): Promise<void> {
    const r = await this.call("PATCH", `${API}/repos/${this.repo}/releases/${id}`, { prerelease });
    if (r.status !== 200) throw new Error(`could not set the pre-release mark of release ${id} (${r.status})`);
  }

  /** Upload one file, replacing an asset of the same name. A transient failure (network error, 5xx) is retried after the half-written asset it may have left is removed. */
  async upload(rel: Release, file: string, o: { attempts?: number; pauseMs?: number } = {}): Promise<void> {
    const name = path.basename(file);
    const attempts = o.attempts ?? 3;
    let known = rel.assets.find((a) => a.name === name);
    for (let n = 1; ; n++) {
      if (known) await this.call("DELETE", `${API}/repos/${this.repo}/releases/assets/${known.id}`);
      let status = 0;
      try {
        status = (await this.call("POST", `${UPLOADS}/repos/${this.repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, fs.readFileSync(file), { "content-type": "application/octet-stream" })).status;
      } catch { /* the connection broke: handled like a 5xx */ }
      if (status === 201) return;
      if (n >= attempts || (status > 0 && status < 500 && status !== 422)) throw new Error(`could not attach ${name} (${status || "no answer"})`);
      await new Promise((r) => setTimeout(r, (o.pauseMs ?? 2000) * n));
      // a cut upload can leave the asset behind half written: look it up again and replace it
      known = (await this.byTag(rel.tag ?? ""))?.assets.find((a) => a.name === name);
    }
  }

  async remove(tag: string): Promise<boolean> {
    const rel = await this.byTag(tag);
    if (!rel) return false;
    const r = await this.call("DELETE", `${API}/repos/${this.repo}/releases/${rel.id}`);
    return r.status === 204;
  }
}

const sha256 = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** A release file that is a channel manifest (beta.json, beta.json.sig). Readers trust the manifest, so it goes up after everything it points at. */
const isManifest = (file: string): boolean => /^[a-z]+\.json(\.sig)?$/.test(path.basename(file));

/** Upload order: the big files first (so the long uploads start early and run side by side), then the small ones, then the manifest's signature, and the manifest json itself last. */
function plan(files: string[]): { bulk: string[]; tail: string[] } {
  const size = (f: string) => fs.statSync(f).size;
  const bulk = files.filter((f) => !isManifest(f)).sort((a, b) => size(b) - size(a) || a.localeCompare(b));
  const tail = files.filter(isManifest).sort((a, b) => Number(a.endsWith(".json")) - Number(b.endsWith(".json")) || a.localeCompare(b));
  return { bulk, tail };
}

/** Is the asset already on the release with the right content? Size always, and the sha256 the API reports when it reports one. */
export function assetIsDone(a: Asset | undefined, file: string): boolean {
  if (!a || (a.state !== undefined && a.state !== "uploaded") || a.size !== fs.statSync(file).size) return false;
  if (a.digest && a.digest.startsWith("sha256:")) return a.digest.slice(7) === sha256(file);
  return true;
}

const filesIn = (dir: string): string[] => fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile()).filter((n) => n !== "feed.json" && n !== "releases.json").sort().map((n) => path.join(dir, n));

/** Runs the uploads: up to `parallel` bulk files at once, then the manifest files one at a time, last. Files already on the release with the right size and checksum are skipped. */
async function attach(gh: GithubReleases, rel: Release, files: string[], o: { parallel?: number; pauseMs?: number; replaceUploaded: boolean; tag: string }): Promise<{ attached: string[]; skipped: string[] }> {
  const { bulk, tail } = plan(files);
  const skipped: string[] = [];
  const work = (f: string): "skip" | "send" => {
    const have = rel.assets.find((a) => a.name === path.basename(f));
    if (assetIsDone(have, f)) { skipped.push(path.basename(f)); return "skip"; }
    // a finished asset with other content on a release that is already published is never overwritten; a half-written one (state not "uploaded") always is
    if (have && !o.replaceUploaded && (have.state === undefined || have.state === "uploaded")) throw new Error(`${o.tag} already has a release with a different ${path.basename(f)}; a published release is not replaced`);
    return "send";
  };
  const up = o.pauseMs === undefined ? {} : { pauseMs: o.pauseMs };
  const todo = bulk.filter((f) => work(f) === "send");
  const tailTodo = tail.filter((f) => work(f) === "send");
  let i = 0;
  const lane = async () => { while (i < todo.length) { const f = todo[i++]!; await gh.upload(rel, f, up); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.parallel ?? 4, todo.length)) }, lane));
  for (const f of tailTodo) await gh.upload(rel, f, up);
  return { attached: files.map((f) => path.basename(f)), skipped: skipped.sort() };
}

/** A new release for the tag with every signed file attached. Safe to run again after a cut run: files already on the release with the right size and checksum are skipped, the rest are uploaded.
 * A finished asset with different content is an error: a published release is never overwritten. */
export async function publishRelease(o: PublishOptions & { parallel?: number; pauseMs?: number }): Promise<{ attached: string[]; skipped: string[] }> {
  const gh = new GithubReleases(o.repo, o.token, o.fetch);
  const found = await gh.byTag(o.tag);
  const rel: Release = found ?? (await gh.create({ tag: o.tag, prerelease: o.prerelease, notes: o.notes }));
  rel.tag = o.tag;
  // a beta or rc is a pre-release and a stable release is not, whoever made the release first (a cut earlier run, or a person)
  if (found && found.prerelease !== undefined && found.prerelease !== o.prerelease) await gh.setPrerelease(found.id, o.prerelease);
  return attach(gh, rel, filesIn(o.dir), { ...(o.parallel === undefined ? {} : { parallel: o.parallel }), ...(o.pauseMs === undefined ? {} : { pauseMs: o.pauseMs }), replaceUploaded: false, tag: o.tag });
}

/** The rolling release a prerelease channel is read from (`channel-beta`): created on first use, its assets replaced each time, the manifest (beta.json) refreshed last. Unchanged files are left alone. */
export async function updateRolling(o: Omit<PublishOptions, "tag" | "prerelease" | "notes"> & { channel: string; parallel?: number; pauseMs?: number }): Promise<{ attached: string[]; skipped: string[] }> {
  const gh = new GithubReleases(o.repo, o.token, o.fetch);
  const tag = `channel-${o.channel}`;
  const rel = (await gh.byTag(tag)) ?? (await gh.create({ tag, prerelease: true, notes: `Rolling release the ${o.channel} channel is read from.` }));
  rel.tag = tag;
  return attach(gh, rel, filesIn(o.dir), { ...(o.parallel === undefined ? {} : { parallel: o.parallel }), ...(o.pauseMs === undefined ? {} : { pauseMs: o.pauseMs }), replaceUploaded: true, tag });
}
