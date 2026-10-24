// Auto-registered mounts (ruling 29): every scripts/shots/mounts/<packet>.tsx is a route /m/<packet> in the shots app.
// Plain JS because Metro only recognises a literal require.context call; mounts.d.ts types it for the .tsx importers.
const context = require.context("../../mounts", false, /^\.\/[^/]+\.tsx$/);

export function mountIds() {
  return context.keys().map((k) => k.replace(/^\.\//, "").replace(/\.tsx$/, ""));
}

export function loadMount(id) {
  return context("./" + id + ".tsx");
}
