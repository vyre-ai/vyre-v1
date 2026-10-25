// email-builder-api (lane L8). The host loads the generated stub handlers while the manifest status is stub, and this module once it is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureEmailBuilder } from "./handlers/index.ts";
