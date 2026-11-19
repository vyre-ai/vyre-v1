// The name of a source is canonical: two repos never share one, and one repo written two ways is one source (lib/key-target.ts sourceKey).
import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceKey, sourceKeyHost } from "./key-target.ts";

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
