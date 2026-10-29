// Metro for the Vyre app inside the monorepo: Expo's default config already watches the workspace root, so @vyre/ui resolves from ui/.
// Hermes bytecode: with jsEngine "hermes" in app.json, `expo export --platform ios|android` precompiles the bundle to Hermes bytecode.
// Startup (P-UI_14): inlineRequires moves each require() to the place it is first used, so a module the first screen never touches is not evaluated at start;
// the production export is measured by scripts/shots/startup.mjs (budget: 1 s desktop, 1.5 s phone at 4x CPU).
// .cjs: this package is "type": "module", and as metro.config.js Metro loaded an empty module and silently ran its defaults, so none of this applied.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const base = config.transformer.getTransformOptions;
config.transformer = {
  ...config.transformer,
  getTransformOptions: async (...args) => {
    const o = base ? await base(...args) : { transform: {} };
    return { ...o, transform: { ...o.transform, inlineRequires: true } };
  },
};

// On the web `react-native` is react-native-lazy.js: react-native-web's names, each required on first use rather than all 63 modules at the first import (phone cold start).
// Named imports already reach one module each (babel-plugin-react-native-web); a whole-module require("react-native"), as expo-router makes, arrives here as its dist/index.
const LAZY_RN = require("node:path").join(__dirname, "react-native-lazy.js");
const WHOLE_RN = new Set(["react-native", "react-native/index", "react-native-web", "react-native-web/dist/index"]);
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && WHOLE_RN.has(moduleName) && context.originModulePath !== LAZY_RN) return { type: "sourceFile", filePath: LAZY_RN };
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
