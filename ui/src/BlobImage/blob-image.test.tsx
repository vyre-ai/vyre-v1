// BlobImage: a blob address is fetched through the shell's fetcher (with the person's token) and drawn from the result; nothing is drawn from the bare address; other addresses pass through.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { installDom, mount, flush } from "../testing/dom.ts";
import { BlobImage, BlobUrlProvider } from "./index.tsx";

const srcs = (n: unknown, out: string[] = []): string[] => {
  if (n === null || typeof n !== "object") return out;
  const o = n as { props?: Record<string, unknown>; children?: unknown[] };
  const s = o.props?.["src"] ?? (o.props?.["source"] as { uri?: string } | undefined)?.uri;
  if (typeof s === "string") out.push(s);
  for (const c of o.children ?? []) srcs(c, out);
  return out;
};
const style = { width: 4, height: 4 };

test("a Space blob address is drawn from what the fetcher returns, never from the bare address; a data address passes through; with no fetcher the address is used as given", async () => {
  const restore = installDom();
  try {
    const asked: string[] = [];
    const fetcher = async (p: string): Promise<string> => {
      asked.push(p);
      return "blob:fetched-with-token";
    };
    const blob = await mount(
      createRoot,
      <BlobUrlProvider fetcher={fetcher}>
        <BlobImage uri="/spaces/spc_1/blobs/blb_unique1" style={style} />
      </BlobUrlProvider>,
    );
    await flush();
    assert.deepEqual(asked, ["/spaces/spc_1/blobs/blb_unique1"]);
    const got = srcs(blob);
    assert.ok(got.includes("blob:fetched-with-token"), JSON.stringify(got));
    assert.ok(!got.some((s) => s.startsWith("/spaces/")), "never the bare address");
    const data = await mount(
      createRoot,
      <BlobUrlProvider fetcher={fetcher}>
        <BlobImage uri="data:image/png;base64,AAAA" style={style} />
      </BlobUrlProvider>,
    );
    await flush();
    assert.ok(srcs(data).includes("data:image/png;base64,AAAA"));
    assert.equal(asked.length, 1, "a data address is not fetched");
    const bare = await mount(createRoot, <BlobImage uri="/spaces/spc_1/blobs/blb_x" style={style} />);
    await flush();
    assert.ok(srcs(bare).includes("/spaces/spc_1/blobs/blb_x"), "no fetcher: as given (a test or a sample)");
  } finally {
    restore();
  }
});

test("a blob-shaped address on another host is never fetched (the sign-in stays home) and is drawn from its bare address; the Space's own origin and a relative address are fetched", async () => {
  const restore = installDom();
  try {
    const asked: string[] = [];
    const fetcher = async (p: string): Promise<string> => {
      asked.push(p);
      return `blob:got-${asked.length}`;
    };
    const draw = async (uri: string): Promise<string[]> => {
      const r = await mount(
        createRoot,
        <BlobUrlProvider fetcher={fetcher} origin="https://space.example">
          <BlobImage uri={uri} style={style} />
        </BlobUrlProvider>,
      );
      await flush();
      return srcs(r);
    };
    const evil = "https://evil.example/spaces/a/blobs/b1";
    assert.deepEqual(await draw(evil), [evil], "drawn bare, with no token");
    assert.deepEqual(asked, [], "not fetched by the app at all");
    assert.ok((await draw("https://space.example/spaces/a/blobs/b2")).some((s) => s.startsWith("blob:got")));
    assert.ok((await draw("/spaces/a/blobs/b3")).some((s) => s.startsWith("blob:got")));
    assert.deepEqual(asked, ["https://space.example/spaces/a/blobs/b2", "/spaces/a/blobs/b3"]);
  } finally {
    restore();
  }
});

test("another person on the same page never gets the first person's picture: a new sign-in is a new fetcher and a new cache; an object address is given back when its last picture leaves", async () => {
  const restore = installDom();
  const revoked: string[] = [];
  const g = globalThis as { URL: { revokeObjectURL?: (u: string) => void } };
  const before = g.URL.revokeObjectURL;
  g.URL.revokeObjectURL = (u) => void revoked.push(u);
  try {
    const mk =
      (who: string) =>
      async (p: string): Promise<string> =>
        `blob:${who}-${p}`;
    const first = mk("ann");
    const second = mk("bob");
    const addr = "/spaces/a/blobs/shared1";
    const a = await mount(
      createRoot,
      <BlobUrlProvider fetcher={first}>
        <BlobImage uri={addr} style={style} />
      </BlobUrlProvider>,
    );
    await flush();
    assert.ok(srcs(a).includes(`blob:ann-${addr}`));
    const b = await mount(
      createRoot,
      <BlobUrlProvider fetcher={second}>
        <BlobImage uri={addr} style={style} />
      </BlobUrlProvider>,
    );
    await flush();
    assert.ok(srcs(b).includes(`blob:bob-${addr}`), "the second person is handed their own fetch");
    assert.ok(!srcs(b).includes(`blob:ann-${addr}`));
    // the last picture leaves the screen: its object address goes back to the browser
    const r = createRoot();
    await act(async () => {
      r.render(
        <BlobUrlProvider fetcher={first}>
          <BlobImage uri="/spaces/a/blobs/leaves1" style={style} />
        </BlobUrlProvider>,
      );
    });
    await flush();
    await act(async () => {
      r.render(<BlobUrlProvider fetcher={first}>{null}</BlobUrlProvider>);
    });
    await new Promise((res) => setTimeout(res, 1200));
    assert.deepEqual(revoked, ["blob:ann-/spaces/a/blobs/leaves1"]);
  } finally {
    if (before) g.URL.revokeObjectURL = before;
    restore();
  }
});
