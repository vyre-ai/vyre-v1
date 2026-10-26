// Lineage of a release tag (the patch fast lane): a tag whose commit is not on main must be the next patch of the newest published stable release and sit on origin/hotfix/<tag>.
const STABLE = /^v(\d+)\.(\d+)\.(\d+)$/;

export function nextPatchTag(tag: string): string | null {
  const m = STABLE.exec(tag);
  return m ? `v${m[1]}.${m[2]}.${Number(m[3]) + 1}` : null;
}

/** The newest stable tag (v1.2.3 only; prereleases are not stable). */
export function newestStable(tags: readonly string[]): string | null {
  const ok = tags.flatMap((t) => { const m = STABLE.exec(t); return m ? [{ t, n: [Number(m[1]), Number(m[2]), Number(m[3])] as const }] : []; });
  ok.sort((a, b) => a.n[0] - b.n[0] || a.n[1] - b.n[1] || a.n[2] - b.n[2]);
  return ok.at(-1)?.t ?? null;
}

export interface LineageFacts {
  tag: string;
  /** The newest published stable release other than this tag. */
  prev: string | null;
  prevIsAncestor: boolean;
  onHotfixBranch: boolean;
}

/** Every refusal; empty when the tag may be built and signed. */
export function lineage(f: LineageFacts): string[] {
  if (f.prev === null) return ["there is no published stable release for this commit to descend from"];
  const out: string[] = [];
  if (!f.prevIsAncestor) out.push(`the newest published stable release ${f.prev} is not an ancestor of this commit`);
  if (nextPatchTag(f.prev) !== f.tag) out.push(`${f.tag} is not the next patch after ${f.prev} (${nextPatchTag(f.prev) ?? "none"})`);
  if (!f.onHotfixBranch) out.push(`this commit is not on origin/hotfix/${f.tag}`);
  return out;
}
