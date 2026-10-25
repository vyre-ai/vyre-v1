// Metro for the Vyre app inside the monorepo: Expo's default config already watches the workspace root, so @vyre/ui resolves from ui/.
// Hermes bytecode: with jsEngine "hermes" in app.json, `expo export --platform ios|android` precompiles the bundle to Hermes bytecode.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
