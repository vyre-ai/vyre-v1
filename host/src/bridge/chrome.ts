// The daemon's Chrome bridge lives in lib/chrome-bridge.ts, a pure module, so the extension's tests (which may not import host/) run the same code the booted daemon serves.
export * from "../../../lib/chrome-bridge.ts";
