import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("the lazy react-native on the web carries every name of react-native-web, each from its own module", () => {
  const index = fs.readFileSync(require.resolve("react-native-web/dist/index.js"), "utf8");
  const want = [...index.matchAll(/export \{ default as (\w+) \} from '\.\/exports\/(\w+)';/g)].map((m) => `${m[1]} ${m[2]}`);
  const lazy = fs.readFileSync(path.join(app, "react-native-lazy.js"), "utf8");
  const have = [...lazy.matchAll(/names\.(\w+) = \(\) => require\("react-native-web\/dist\/exports\/(\w+)"\)\.default;/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(want.length > 60);
  assert.deepEqual(have, want);
  assert.doesNotMatch(index, /export \*/, "react-native-web's index re-exports only named defaults");
});

test("Metro loads its config (.cjs in a type: module package) and sends whole-module react-native imports on the web to the lazy module", () => {
  const config = require(path.join(app, "metro.config.cjs")) as { resolver: { resolveRequest: (c: object, m: string, p: string) => unknown } };
  const lazy = path.join(app, "react-native-lazy.js");
  const up = (_c: object, m: string): unknown => `upstream ${m}`;
  for (const m of ["react-native", "react-native/index", "react-native-web", "react-native-web/dist/index"]) {
    assert.deepEqual(config.resolver.resolveRequest({ originModulePath: "/a.js", resolveRequest: up }, m, "web"), { type: "sourceFile", filePath: lazy });
  }
  assert.equal(config.resolver.resolveRequest({ originModulePath: "/a.js", resolveRequest: up }, "react-native-web/dist/exports/View", "web"), "upstream react-native-web/dist/exports/View");
  assert.equal(config.resolver.resolveRequest({ originModulePath: "/a.js", resolveRequest: up }, "react-native", "ios"), "upstream react-native");
  assert.equal(config.resolver.resolveRequest({ originModulePath: lazy, resolveRequest: up }, "react-native-web", "web"), "upstream react-native-web");
  const flagsUser = path.join(app, "../../node_modules/expo-router/build/screensFeatureFlags.js");
  assert.equal(config.resolver.resolveRequest({ originModulePath: flagsUser, resolveRequest: up }, "react-native-screens", "web"), "upstream react-native-screens/lib/module/flags");
  assert.equal(config.resolver.resolveRequest({ originModulePath: "/a.js", resolveRequest: up }, "react-native-screens", "web"), "upstream react-native-screens");
  assert.match(fs.readFileSync(require.resolve("react-native-screens/lib/module/index.js"), "utf8"), /export \{ compatibilityFlags, featureFlags \} from '\.\/flags'/, "the index's flags are the flags module's own object");
  assert.ok(!fs.existsSync(path.join(app, "metro.config.js")), "a metro.config.js here loads as an empty ES module and Metro silently runs its defaults");
});
