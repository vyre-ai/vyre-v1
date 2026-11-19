// The name of a source is canonical: two repos never share one, and one repo written two ways is one source (lib/key-target.ts sourceKey).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileLine, fingerprintOf, siteKeyPairs, sourceKey, sourceKeyHost, uploadFingerprint } from "./key-target.ts";

const key = (repo: string): string | null => sourceKey({ repo });
const git = (url: string, branch = "", root = ""): string => `git:${JSON.stringify([url, branch, root])}`;

test("a repo written different ways is one source on GitHub, case and all", () => {
  const want = git("https://github.com/acme/app");
  for (const r of [
    "acme/app",
    "ACME/App",
    "github.com/acme/app",
    "https://github.com/Acme/App.git",
    "https://www.github.com/acme/app/",
    "https://github.com/acme/app.GIT",
  ])
    assert.equal(key(r), want, r);
});

test("two repos never share a name: dots, hosts, subgroups and case on other hosts all stay apart", () => {
  const pairs: [string, string][] = [
    ["https://d/c/a.b", "https://c.d/b/a"],
    ["https://gl.example/g/sub/name", "https://gl.example/g/n.s"],
    ["https://gl.example/g/sub/n", "https://gl.example/g/sub.n"],
    ["https://git.example/O/N", "https://git.example/o/n"],
    ["https://git.example/a/b", "https://git.example:8443/a/b"],
    ["https://git.example/a/b", "https://other.example/a/b"],
    ["acme/app", "https://git.example/acme/app"],
  ];
  for (const [a, b] of pairs) {
    assert.ok(key(a) && key(b), `${a} and ${b} can be named`);
    assert.notEqual(key(a), key(b), `${a} is not ${b}`);
  }
});

test("a host is lowercased, the default port dropped, dots resolved, and .git removed; the path keeps its case", () => {
  assert.equal(key("https://Git.Example:443/Team/../Team/Repo.git"), git("https://git.example/Team/Repo"));
  assert.equal(key("https://git.example:8443/a/b/"), git("https://git.example:8443/a/b"));
});

test("what cannot be named is null: a login in the address, a query, http, nothing", () => {
  for (const r of [
    "https://u:p@git.example/a/b",
    "https://git.example/a/b?x=1",
    "http://git.example/a/b",
    "",
    "just-a-word",
    "https://git.example/",
  ])
    assert.equal(key(r), null, r);
});

test("uploaded files are named by the site and what the files are; without a reading of them they cannot be named", () => {
  assert.equal(sourceKey({ folderId: "fld_a", fp: "f1" }, "sit_1"), `upload:${JSON.stringify(["sit_1", "f1", ""])}`);
  assert.notEqual(
    sourceKey({ folderId: "fld_a", fp: "f1" }, "sit_1"),
    sourceKey({ folderId: "fld_a", fp: "f2" }, "sit_1"),
  );
  assert.equal(sourceKey({ folderId: "fld_a" }, "sit_1"), null);
  assert.equal(sourceKey({ path: "/srv/x" }, "sit_1"), "path:sit_1");
  assert.equal(sourceKey({ path: "/srv/x" }), null);
});

test("a source's store name is its SHA-256 in two labels, stable and different for different sources", async () => {
  const a = await sourceKeyHost(git("https://github.com/acme/app"));
  assert.match(a, /^[0-9a-f]{32}\.[0-9a-f]{32}\.src\.invalid$/);
  assert.equal(a, await sourceKeyHost(git("https://github.com/acme/app")));
  assert.notEqual(a, await sourceKeyHost(git("https://github.com/acme/app2")));
});

test("a branch and a folder are part of the source; a name made of dots only is refused", () => {
  const k = (s: { repo: string; branch?: string; root?: string }) => sourceKey(s);
  assert.notEqual(k({ repo: "acme/app" }), k({ repo: "acme/app", branch: "x" }));
  assert.notEqual(k({ repo: "acme/app", branch: "a" }), k({ repo: "acme/app", branch: "b" }));
  assert.notEqual(k({ repo: "acme/app", root: "apps/a" }), k({ repo: "acme/app", root: "apps/b" }));
  assert.equal(k({ repo: "ACME/App", branch: "main" }), k({ repo: "https://github.com/acme/app.git", branch: "main" }));
  // a branch that holds the separators of a key does not become another part
  assert.notEqual(k({ repo: "acme/app", branch: 'x","y' }), k({ repo: "acme/app", branch: "x", root: "y" }));
  for (const r of ["acme/..", "../app", "./x", "https://git.example/a/b/.."])
    assert.equal(key(r), r.startsWith("https") ? key(r) : null, r);
  assert.equal(key("acme/.."), null);
  assert.equal(key("../app"), null);
  assert.equal(key("./x"), null);
});

// Files as a fake: a folder's files with their versions, paged like the real listing
const filesOf =
  (
    rows: Record<string, { fileId: string; name: string; version: number; size: number }[]>,
    folders: Record<string, { folderId: string; name: string }[]> = {},
  ) =>
  async (cap: string, i: unknown): Promise<unknown> => {
    const q = i as { folder?: string; cursor?: string; limit?: number; fileId?: string };
    if (cap === "files.get") {
      const f = Object.values(rows)
        .flat()
        .find((x) => x.fileId === q.fileId);
      return f ? { file: f } : null;
    }
    const all = rows[q.folder as string];
    if (!all) return null;
    const from = Number(q.cursor ?? 0);
    const to = Math.min(all.length, from + (q.limit ?? 500));
    return {
      files: all.slice(from, to),
      folders: from === 0 ? (folders[q.folder as string] ?? []) : [],
      ...(to < all.length ? { next: String(to) } : {}),
    };
  };
const f1 = { fileId: "fil_1", name: "index.html", version: 1, size: 5 };

test("a fingerprint is of the versions, the names and the folders, and of every page", async () => {
  const fp = (rows: Parameters<typeof filesOf>[0], folders?: Parameters<typeof filesOf>[1]) =>
    uploadFingerprint({ folderId: "fld" }, filesOf(rows, folders));
  const base = await fp({ fld: [f1] });
  assert.ok(base);
  assert.equal(base, await fp({ fld: [f1] }), "the same files, the same fingerprint");
  assert.notEqual(base, await fp({ fld: [{ ...f1, version: 2 }] }), "a new version");
  assert.notEqual(base, await fp({ fld: [{ ...f1, size: 6 }] }), "a new size");
  assert.notEqual(base, await fp({ fld: [{ ...f1, name: "evil.html" }] }), "a renamed file");
  assert.notEqual(base, await fp({ fld: [f1] }, { fld: [{ folderId: "fld_s", name: "sub" }] }), "a folder in the tree");
  assert.notEqual(
    await fp({ fld: [], fld_s: [f1] }, { fld: [{ folderId: "fld_s", name: "sub" }] }),
    await fp({ fld: [f1], fld_s: [] }, { fld: [{ folderId: "fld_s", name: "sub" }] }),
    "the same file moved into a folder",
  );
  const many = Array.from({ length: 1300 }, (_, n) => ({ fileId: `fil_${n}`, name: `f${n}`, version: 1, size: 1 }));
  const big = await fp({ fld: many });
  assert.ok(big, "more than one page");
  assert.notEqual(
    big,
    await fp({ fld: many.map((x, n) => (n === 1250 ? { ...x, version: 2 } : x)) }),
    "the last page is read",
  );
  assert.equal(
    await fp({ fld: Array.from({ length: 20_001 }, (_, n) => ({ ...f1, fileId: `fil_${n}` })) }),
    null,
    "over the cap",
  );
  assert.equal(await fp({}), null, "a folder that is not there");
  assert.equal(
    await fingerprintOf([fileLine("a", 1, 1, "x"), fileLine("b", 1, 1, "y")]),
    await fingerprintOf([fileLine("b", 1, 1, "y"), fileLine("a", 1, 1, "x")]),
    "the order of the listing does not matter",
  );
});

const KEY = [{ name: "K", handle: "#Crm_Key", scope: "production" }];
test("uploaded files with no fingerprint to compare hold: unread now, or no baseline from the last deploy", async () => {
  const upload = (fp?: string) => ({ folderId: "fld", ...(fp ? { fp } : {}) });
  const pairs = (source: ReturnType<typeof upload>, deployedFp: string | null, given?: ReturnType<typeof upload>) =>
    siteKeyPairs({ siteId: "sit_1" }, { source, env: KEY, builtFrom: null, deployedFp }, given ?? null);
  // the files as they were deployed: free
  assert.deepEqual(pairs(upload("a"), "a"), []);
  // replaced: the files as they are now are the pair
  assert.deepEqual(
    pairs(upload("b"), "a").map((p) => p.handle),
    ["#Crm_Key"],
  );
  // unread now (a read error, the cap, nobody to read as): the "?" pair that no approval covers
  assert.deepEqual(pairs(upload(), "a"), [{ handle: "?", source: null }]);
  // nothing recorded at the last deploy: held once, for the files as they are now
  assert.equal(pairs(upload("a"), null)[0]?.handle, "#Crm_Key");
  assert.ok(pairs(upload("a"), null)[0]?.source, "approvable");
  assert.deepEqual(pairs(upload(), null), [{ handle: "?", source: null }]);
  // a call that names the same folder is judged by the files too
  assert.deepEqual(
    pairs(upload("b"), "a", upload("b")).map((p) => p.handle),
    ["#Crm_Key"],
  );
  assert.deepEqual(pairs(upload("a"), "a", upload()), [{ handle: "?", source: null }]);
});

test("a yes is spent when it is used: the build it was for takes it, a second build does not", async () => {
  const { noteApproved, wasApproved } = await import("./key-target.ts");
  const call = { traceId: "9f".repeat(16) };
  noteApproved(call, "sit_1");
  assert.equal(wasApproved(call, "sit_1"), true);
  assert.equal(wasApproved(call, "sit_1"), false);
});

test("visible text writes out every character that hides itself, and cuts by whole graphemes", async () => {
  const { visibleText } = await import("./visible-text.ts");
  assert.equal(visibleText("ab", 40), "ab");
  // each of these, built by number so the file holds no invisible character
  const hidden: [number, string][] = [
    [0x202e, "202e"],
    [0x2066, "2066"],
    [0x2028, "2028"],
    [0x2029, "2029"],
    [0x2060, "2060"],
    [0x2064, "2064"],
    [0xfeff, "feff"],
    [0x061c, "061c"],
    [0x180e, "180e"],
    [0x00ad, "00ad"],
    [0x034f, "034f"],
    [0x200b, "200b"],
    [0x000a, "000a"],
    [0x3164, "3164"],
    [0x2800, "2800"],
    [0xfe0f, "fe0f"],
  ];
  for (const [n, hex] of hidden) assert.equal(visibleText(`a${String.fromCodePoint(n)}b`, 40), `a\\u${hex}b`, hex);
  assert.equal(visibleText(`a${String.fromCodePoint(0xe0041)}b`, 40), "a\\u{e0041}b", "a tag character");
  // a family (one grapheme of several code points) is cut whole, never in the middle; its joiners are written out
  const family = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map((n) => String.fromCodePoint(n)).join("");
  assert.equal(
    visibleText(`${family}x`, 1),
    `${String.fromCodePoint(0x1f468)}\\u200d${String.fromCodePoint(0x1f469)}\\u200d${String.fromCodePoint(0x1f467)}`,
  );
  assert.equal(Array.from(visibleText("x".repeat(100), 40)).length, 40);
  assert.equal(
    visibleText(`e${String.fromCodePoint(0x0301)}x`, 1),
    `e${String.fromCodePoint(0x0301)}`,
    "a combined letter is one",
  );
});
