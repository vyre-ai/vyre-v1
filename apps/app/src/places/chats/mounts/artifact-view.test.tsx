// An artifact's tab never shows a blank white rectangle (rc.26, 13 Nov 2026: the Space's artifact host did not answer, the frame still reported "loaded", and the tab was empty). A frame says nothing
// across origins, so the tab asks the artifact host itself first: the host answers the dead code with its own marked page. Host silent: the tab shows the failed state with Retry. Host answering: the page.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, flush, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { ArtifactView } from "./ArtifactView.tsx";
import { artifactHostAnswers, PROBE_CODE } from "./artifact-address.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";

const CODE = "a".repeat(48);
const MARKED = '<!doctype html><meta name="vyre-artifact-host" content="1"><title>This link has ended</title>';
const RELAY_404 = "<!doctype html><title>Not found</title><p>No Space of that name is connected.</p>";

function runtime(url: string): ShellRuntime {
  return {
    me: { id: "usr_me", name: "Me" },
    baseUrl: "https://mla.vyre.run",
    clock: () => ({ now: Date.UTC(2026, 10, 13, 12, 0), offsetMin: 0 }),
    call: (cap: string) => {
      if (cap === "sites.artifact_open") return Promise.resolve({ path: `/x/${CODE}`, url, expiresAt: 1 });
      if (cap === "sites.get")
        return Promise.resolve({
          site: {
            siteId: "sit_1",
            name: "Crew page",
            kind: "artifact",
            owner: "usr_me",
            state: "ready",
            access: "private",
            updatedAt: 1,
          },
        });
      return Promise.resolve({});
    },
    open: () => undefined,
    openUrl: () => undefined,
    principals: { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [] }) },
  } as unknown as ShellRuntime;
}

type Answer = (url: string, init?: { mode?: string }) => Promise<{ text(): Promise<string> }>;
const withFetch = async (answer: Answer, run: () => Promise<void>): Promise<void> => {
  const g = globalThis as { fetch?: unknown };
  const had = g.fetch;
  g.fetch = answer;
  try {
    await run();
  } finally {
    g.fetch = had;
  }
};
const text = (t: string): { text(): Promise<string> } => ({ text: () => Promise.resolve(t) });
const view = (url: string) => (
  <ArtifactView rt={runtime(url)} artifactId="sit_1" share={false} back={() => undefined} gone={() => undefined} />
);

test("the host check: the marked page is the host; a relay's 404, silence and a name that does not exist are not; a refused read falls back to asking without reading", async () => {
  const addr = `https://a.mla.vyre.run/x/${CODE}?embed=1`;
  const asked: string[] = [];
  assert.equal(await artifactHostAnswers(addr, async (u, i) => (asked.push(`${i?.mode} ${u}`), text(MARKED))), true);
  assert.deepEqual(
    asked,
    [`cors https://a.mla.vyre.run/x/${PROBE_CODE}`],
    "the dead code, on the host's own origin, never the real code",
  );
  assert.equal(
    await artifactHostAnswers(addr, async () => text(RELAY_404)),
    false,
    "the relay's own page is not this host",
  );
  assert.equal(
    await artifactHostAnswers(addr, async () => Promise.reject(new TypeError("Failed to fetch"))),
    false,
    "no record, no certificate: nothing answers either way",
  );
  // an older server does not allow the read: a name that answers without it is let through as before
  assert.equal(
    await artifactHostAnswers(addr, async (_u, i) =>
      i?.mode === "cors" ? Promise.reject(new TypeError("blocked")) : text(""),
    ),
    true,
  );
  assert.equal(
    await artifactHostAnswers(addr, () => new Promise(() => undefined), 20),
    false,
    "a host that never answers is silent after the limit",
  );
  assert.equal(
    await artifactHostAnswers("/x/abc", async () => Promise.reject(new Error("never asked"))),
    true,
    "the app's own origin has nothing to check",
  );
});

test("the artifact host does not answer: the tab shows the failed state with Retry and says what is wrong, never a blank frame", async () => {
  const restore = installDom();
  try {
    await withFetch(
      async () => Promise.reject(new TypeError("Failed to fetch")),
      async () => {
        const root = await mount(createRoot, view(`https://mla-a.vyre.run/x/${CODE}`));
        await flush();
        const err = find(root, "artifact-error");
        assert.ok(err, "the failed state");
        assert.equal(find(root, "artifact-frame"), null, "no frame to be blank");
        assert.equal(find(root, "artifact-loading"), null);
        const t = textOf(err);
        assert.match(t, /This page could not be loaded from the Space/);
        assert.match(t, /mla-a\.vyre\.run did not answer/);
        assert.ok(find(root, "state-retry"), "Retry");
      },
    );
  } finally {
    restore();
  }
});

test("a name the relay answers with its own 404 is the same failed state; the host answering shows the page; Retry asks again and finds a host that now answers", async () => {
  const restore = installDom();
  try {
    let phase: "relay" | "host" = "relay";
    await withFetch(
      async () => text(phase === "relay" ? RELAY_404 : MARKED),
      async () => {
        const root = await mount(createRoot, view(`https://mla-a.vyre.run/x/${CODE}`));
        await flush();
        assert.ok(find(root, "artifact-error"), "the relay's 404 is not a page of this Space");
        assert.equal(find(root, "artifact-frame"), null);
        phase = "host";
        await press(find(root, "state-retry"));
        await flush();
        assert.equal(find(root, "artifact-error"), null, "the failed state clears");
        const frame = find(root, "artifact-frame");
        assert.ok(frame, "the frame is there once the host answers");
        assert.match(String(frame.props["src"]), /^https:\/\/mla-a\.vyre\.run\/x\/a{48}\?embed=1$/);
      },
    );
  } finally {
    restore();
  }
});
