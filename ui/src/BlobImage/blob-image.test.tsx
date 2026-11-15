// BlobImage: a blob address is fetched through the shell's fetcher (with the person's token) and drawn from the result; nothing is drawn from the bare address; other addresses pass through.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
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
