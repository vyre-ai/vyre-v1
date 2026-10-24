// Home place, first five sections (spec 3.1, 2.8, 4.2, ARCH 7.1).
// Each section reads the local replica through createScreenHooks. The digest is a synced row, so it opens offline.

import { createFakeReplica, createScreenHooks } from "../../../../../client/src/index.ts";
import { nativeTokens, skinById } from "../../../../../ui/src/tokens/skins.ts";
import { renderDigest } from "./sections-a/away-digest.tsx";
import { actOnNeed, assignFromFace, undoFromDigest } from "./sections-a/call.ts";
import { CORE_SEED_FACES } from "./sections-a/faces.ts";
import type { Face } from "./sections-a/faces.ts";
import { esc } from "./sections-a/html.ts";
import { renderMyWork } from "./sections-a/my-work.tsx";
import { needsYouTop3, renderNeedsYou } from "./sections-a/needs-you.tsx";
import { atRiskRule, renderProjects } from "./sections-a/projects-at-risk.tsx";
import { bindHomeReplica } from "./sections-a/replica.ts";
import { renderRoutines } from "./sections-a/routines-today.tsx";
import { HOME_SCREEN_INDEX } from "./sections-a/screens.ts";
import type { HomeCall, HomeSession } from "./sections-a/session.ts";

export type { Face, HomeCall, HomeSession };
export { CORE_SEED_FACES, actOnNeed, assignFromFace, atRiskRule, needsYouTop3, undoFromDigest };

export const HOME_SECTION_IDS = ["needs-you", "my-work", "projects-at-risk", "away-digest", "routines-today"] as const;

export interface HomeSkin {
  id: "northwind" | "harbor";
  name: string;
  kit: string;
  /** Id in ui/src/tokens/skins.ts. Northwind uses the default light skin. Harbor Studio uses Linen. */
  tokens: string;
}

export const HOME_SKINS: readonly HomeSkin[] = [
  { id: "northwind", name: "Northwind", kit: "default", tokens: "paper" },
  { id: "harbor", name: "Harbor Studio", kit: "harbor-studio", tokens: "linen" },
];

export const HOME_SHOT_WIDTHS = [1280, 390] as const;

export function openHome(spaceId: string, faces: readonly Face[] = CORE_SEED_FACES, bind = true): HomeSession {
  const replica = createFakeReplica(spaceId);
  if (bind) bindHomeReplica(replica);
  return {
    spaceId,
    replica,
    hooks: createScreenHooks(replica, HOME_SCREEN_INDEX),
    faces,
    online: true,
    calls: [],
  };
}

export function renderHome(session: HomeSession): string {
  const body = [
    renderNeedsYou(session),
    renderMyWork(session),
    renderProjects(session),
    renderDigest(session),
    renderRoutines(session),
  ].join("");
  const online = session.online ? "true" : "false";
  return `<main data-place="home" data-space="${esc(session.spaceId)}" data-online="${online}" data-kbd="j k Enter">${body}</main>`;
}

/** Full document for a design shot. scripts/shots is not in this tree (P-L11_01); the document is what that script would capture. */
export function renderHomeShot(session: HomeSession, skin: HomeSkin, width: number): string {
  const found = skinById(skin.tokens);
  if (!found) throw new Error(`unknown skin ${skin.tokens}`);
  const tokens = nativeTokens(found);
  const css = Object.entries(tokens).map(([key, value]) => `${key}:${value}`).join(";");
  const accent = tokens["--accent"];
  return `<!doctype html><html data-skin="${esc(skin.name)}" data-kit="${esc(skin.kit)}" data-viewport="${width}" data-accent="${esc(accent)}"><head><title>Vyre · ${esc(skin.name)}</title><style>body{width:${width}px;${css}}</style></head><body data-place="home" data-width="${width}">${renderHome(session)}</body></html>`;
}
