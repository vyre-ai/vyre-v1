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
// the relay edge's real answer for a name no Space holds: a bare 404 with no access-control-allow-origin, so a browser REFUSES to read it from the app's origin
import RELAY_EDGE from "../../../../tests/fixtures/relay-edge-unclaimed-404.json" with { type: "json" };
/** A fetch as the browser does it for an answer with these headers: a cross-origin read of an answer without access-control-allow-origin is REFUSED (the fetch rejects), it does not hand back the body. */
const asBrowser =
  (r: { headers: Record<string, string>; body: string }): Answer =>
  async (_u, i) => {
    if (i?.mode === "cors" && !r.headers["access-control-allow-origin"]) throw new TypeError("Failed to fetch");
    return text(r.body);
  };
const relayEdge: Answer = asBrowser(RELAY_EDGE);

const READY = { status: "ready", data: [] }; // one snapshot object for good
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
    principals: { subscribe: () => () => undefined, getSnapshot: () => READY },
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
    await artifactHostAnswers(addr, relayEdge),
    false,
    "the relay edge's real 404 (no access-control-allow-origin, so the browser refuses the read) is not this host",
  );
  assert.equal(
    await artifactHostAnswers(addr, async () => Promise.reject(new TypeError("Failed to fetch"))),
    false,
    "no record, no certificate: nothing answers either way",
  );
  // an answer the app cannot read is never taken for success, whatever the host form (an older server that does not allow the read shows the failed state until it updates)
  for (const form of ["https://mla-a.vyre.run", "https://a.mla.vyre.run", "https://a.team.example.com"])
    assert.equal(await artifactHostAnswers(`${form}/x/${CODE}`, relayEdge), false, form);
  assert.equal(
    await artifactHostAnswers(
      addr,
      asBrowser({ headers: { "access-control-allow-origin": "*" }, body: "<p>some page</p>" }),
    ),
    false,
    "readable but not marked",
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
      (u, i) => (phase === "relay" ? relayEdge(u, i) : Promise.resolve(text(MARKED))),
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

/** every node with this aria-label, the way react-native-web renders accessibilityLabel */
const byLabel = (n: { props?: Record<string, unknown>; children?: unknown[] }, label: string): typeof n | null => {
  if (n.props?.["aria-label"] === label) return n;
  for (const c of n.children ?? []) {
    if (c && typeof c === "object") {
      const f = byLabel(c as typeof n, label);
      if (f) return f;
    }
  }
  return null;
};

test("desktop app: Share steps the native page aside and it comes back as it was, with no new one-time address; the line under the name is read after a share, not on close", async () => {
  const restore = installDom();
  const g = globalThis as { __TAURI__?: unknown };
  const sent: string[] = [];
  g.__TAURI__ = {
    core: {
      invoke: async (cmd: string) => {
        sent.push(cmd);
        return null;
      },
    },
  };
  const el = globalThis as { ResizeObserver?: unknown };
  const hadRO = el.ResizeObserver;
  el.ResizeObserver = undefined;
  try {
    let n = 0;
    let sitesGets = 0;
    const base = runtime("");
    const rt = {
      ...base,
      screens: {},
      call: (cap: string, input?: unknown) => {
        if (cap === "sites.artifact_open") {
          n += 1;
          const code = String(n).padStart(48, "0");
          return Promise.resolve({ path: `/x/${code}`, url: `https://a.mla.vyre.run/x/${code}`, expiresAt: 1 });
        }
        if (cap === "sites.get") sitesGets += 1;
        return (base.call as (c: string, i?: unknown) => unknown)(cap, input);
      },
    } as unknown as ShellRuntime;
    await withFetch(
      async () => text(MARKED),
      async () => {
        const root = await mount(
          createRoot,
          <ArtifactView rt={rt} artifactId="sit_1" share={false} back={() => undefined} gone={() => undefined} />,
        );
        await flush();
        assert.ok(find(root, "artifact-desktop-frame"), "the desktop frame");
        assert.equal(n, 1, "one code asked for so far");
        const before = sitesGets;
        await press(find(root, "artifact-share"));
        await flush();
        assert.ok(sent.includes("artifact_view_hide"), "while the sheet is open the page steps aside");
        assert.ok(!sent.includes("artifact_view_close"), "it is not closed");
        assert.ok(find(root, "artifact-desktop-frame"), "the frame element stays, so the page keeps its place");
        await press(byLabel(root as never, "Close") as never);
        await flush();
        await flush();
        assert.equal(n, 1, "no new code: the same page comes back as it was");
        assert.equal(
          sitesGets,
          before,
          "closing without sharing reads nothing again (a share does: apps/app/tests/artifact-share.live.test.ts)",
        );
      },
    );
  } finally {
    el.ResizeObserver = hadRO;
    delete g.__TAURI__;
    restore();
  }
});
