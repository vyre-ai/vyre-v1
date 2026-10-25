// Metro for the Vyre app inside the monorepo: Expo's default config already watches the workspace root, so @vyre/ui resolves from ui/.
// Hermes bytecode: with jsEngine "hermes" in app.json, `expo export --platform ios|android` precompiles the bundle to Hermes bytecode.
// Startup (P-UI_14): inlineRequires moves each require() to the place it is first used, so a module the first screen never touches is not evaluated at start;
// the production export is measured by scripts/shots/startup.mjs (budget: 1 s desktop, 1.5 s phone at 4x CPU).
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

module.exports = config;
