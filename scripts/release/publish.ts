// Publishing to GitHub Releases through the REST API (P-L11_18). The runners the release jobs land on do not all have the `gh` command, so the workflow calls this instead: it needs only
// node and the job's GITHUB_TOKEN (contents: write). Nothing here signs; it attaches files that are already signed.
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

const API = "https://api.github.com";
const UPLOADS = "https://uploads.github.com";

const realFetch: ApiFetch = async (url, init) => {
  const r = await globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(300_000) } as never);
  return { status: r.status, json: () => r.json() as Promise<unknown> };
};

export class GithubReleases {
  private readonly f: ApiFetch;
  constructor(private readonly repo: string, private readonly token: string, f?: ApiFetch) { this.f = f ?? realFetch; }

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
  async byTag(tag: string): Promise<{ id: number; assets: Array<{ id: number; name: string }> } | null> {
    const r = await this.call("GET", `${API}/repos/${this.repo}/releases/tags/${encodeURIComponent(tag)}`);
    return r.status === 200 ? r.data : null;
  }

  async create(o: { tag: string; prerelease: boolean; notes: string }): Promise<{ id: number; assets: Array<{ id: number; name: string }> }> {
    const r = await this.call("POST", `${API}/repos/${this.repo}/releases`, { tag_name: o.tag, name: o.tag, body: o.notes, prerelease: o.prerelease, draft: false });
    if (r.status !== 201) throw new Error(`could not create the release ${o.tag} (${r.status})`);
    return { id: r.data.id, assets: [] };
  }

  /** Upload one file, replacing an asset of the same name. */
  async upload(rel: { id: number; assets: Array<{ id: number; name: string }> }, file: string): Promise<void> {
    const name = path.basename(file);
    const old = rel.assets.find((a) => a.name === name);
    if (old) await this.call("DELETE", `${API}/repos/${this.repo}/releases/assets/${old.id}`);
    const r = await this.call("POST", `${UPLOADS}/repos/${this.repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, fs.readFileSync(file), { "content-type": "application/octet-stream" });
    if (r.status !== 201) throw new Error(`could not attach ${name} (${r.status})`);
  }

  async remove(tag: string): Promise<boolean> {
    const rel = await this.byTag(tag);
    if (!rel) return false;
    const r = await this.call("DELETE", `${API}/repos/${this.repo}/releases/${rel.id}`);
    return r.status === 204;
  }
}

const filesIn = (dir: string): string[] => fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile()).filter((n) => n !== "feed.json" && n !== "releases.json").sort().map((n) => path.join(dir, n));

/** A new release for the tag with every signed file attached. A tag that already has a release is an error: a release is never overwritten. */
export async function publishRelease(o: PublishOptions): Promise<{ attached: string[] }> {
  const gh = new GithubReleases(o.repo, o.token, o.fetch);
  if (await gh.byTag(o.tag)) throw new Error(`${o.tag} already has a release; a published release is not replaced`);
  const rel = await gh.create({ tag: o.tag, prerelease: o.prerelease, notes: o.notes });
  const files = filesIn(o.dir);
  for (const f of files) await gh.upload(rel, f);
  return { attached: files.map((f) => path.basename(f)) };
}

/** The rolling release a prerelease channel is read from (`channel-beta`): created on first use, its assets replaced each time. */
export async function updateRolling(o: Omit<PublishOptions, "tag" | "prerelease" | "notes"> & { channel: string }): Promise<{ attached: string[] }> {
  const gh = new GithubReleases(o.repo, o.token, o.fetch);
  const tag = `channel-${o.channel}`;
  const rel = (await gh.byTag(tag)) ?? (await gh.create({ tag, prerelease: true, notes: `Rolling release the ${o.channel} channel is read from.` }));
  const files = filesIn(o.dir);
  for (const f of files) await gh.upload(rel, f);
  return { attached: files.map((f) => path.basename(f)) };
}
