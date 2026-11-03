// The Artifacts page and one artifact's tab: what they draw before anything has loaded (the title, the search, the header row), over a scripted runtime.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactsPage } from "./ArtifactsPage.tsx";
import { ArtifactView } from "./ArtifactView.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";

const rt = {
  me: { id: "me", name: "Irfad" },
  clock: () => ({ now: Date.UTC(2026, 10, 4, 16, 0), offsetMin: 0 }),
  call: () => new Promise(() => undefined),
  open: () => undefined,
  openUrl: () => undefined,
  principals: { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [] }) },
} as unknown as ShellRuntime;

test("the Artifacts page has its title, a search and the Mine menu", () => {
  const html = renderToStaticMarkup(<ArtifactsPage rt={rt} />);
  assert.match(html, /Artifacts/);
  assert.match(html, /aria-label="Search artifacts"/);
  assert.match(html, /aria-label="Show: Mine"/);
});

test("an artifact's tab has one header row: back, Share and More, and a loading state until the page says it loaded", () => {
  const html = renderToStaticMarkup(<ArtifactView rt={rt} artifactId="sit_1" share={false} back={() => undefined} gone={() => undefined} />);
  for (const w of ["Back to Artifacts", "Share", "More"]) assert.match(html, new RegExp(`aria-label="${w}"`));
  assert.match(html, /artifact-loading/);
  assert.doesNotMatch(html, /Floating|Back to Chats/);
});
