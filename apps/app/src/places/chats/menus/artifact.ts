// The menu of an artifact (a row on the Artifacts page): Open, Share, Copy Link, Rename and Delete, each one call or one sheet. Delete asks first, because the link stops working.
// Publish and Unpublish are not here: sites.artifact_publish makes or updates an artifact from a source, it does not switch one off. Pure: facts in, entries out.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { KEY, item, sep, tidy } from "./shared.ts";

export interface ArtifactFacts {
  /** The person owns it: only an owner shares, renames or deletes. */
  mine: boolean;
}
export interface ArtifactDo { open(): void; share?(): void; copyLink?(): void; rename?(): void; remove?(): void }

export function artifactMenu(f: ArtifactFacts, d: ArtifactDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    f.mine && d.share ? item("Share…", d.share) : null,
    d.copyLink ? item("Copy Link", d.copyLink) : null,
    f.mine && d.rename ? item("Rename…", d.rename, { hint: KEY.rename }) : null,
    f.mine && d.remove ? sep : null,
    f.mine && d.remove ? item("Delete…", d.remove, { danger: true }) : null,
  ]);
}
