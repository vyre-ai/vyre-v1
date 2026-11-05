// @ts-check
// Whether the extension and the Vyre app are the same release. The app answers hello with its version ("1.0.0-rc.22", or "1.0.0" for a final release); the extension's manifest carries the same text as version_name.

/**
 * Compare two release names. Returns a negative number when a is older, 0 when the same, positive when newer; null when either cannot be read.
 * A final release is newer than any of its release candidates.
 * @param {unknown} a @param {unknown} b
 * @returns {number | null}
 */
export function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return /** @type {number} */ (pa.core[i]) - /** @type {number} */ (pb.core[i]);
  return pa.rc - pb.rc;
}

/** @param {unknown} v @returns {{ core: number[], rc: number } | null} */
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], rc: m[4] === undefined ? Number.MAX_SAFE_INTEGER : Number(m[4]) };
}

/**
 * What the extension should tell the person when the app answered: "ok", "reload" (the app is newer, so this extension is the old copy: reload it) or "update_app" (the extension is newer than the app).
 * An app that sends no version, or a version that cannot be read, is "ok": the extension does not guess.
 * @param {unknown} appVersion @param {unknown} extensionVersion
 * @returns {"ok" | "reload" | "update_app"}
 */
export function versionState(appVersion, extensionVersion) {
  const c = compareVersions(extensionVersion, appVersion);
  if (c === null || c === 0) return "ok";
  return c < 0 ? "reload" : "update_app";
}
