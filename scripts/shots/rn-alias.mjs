// Preload for .tsx tests:  node --import tsx --import ./scripts/shots/rn-alias.mjs --test x.test.tsx
// Maps the bare specifier `react-native` to rn-web-shim.mjs for every module the process loads.
import { register } from "node:module";
register("./rn-alias-hooks.mjs", import.meta.url);
