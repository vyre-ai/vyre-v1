// Which changed paths a rule is willing to read. Tests and this package are skipped
// so fixture strings inside the lint tests are not linted as product code.

export function skipped(file: string): boolean {
  return (
    /(?:^|\/)scripts\/lint\//.test(file) ||
    /\.test\.(?:m?js|cjs|tsx?|jsx)$/.test(file) ||
    /(?:^|\/)(?:generated|vendor|node_modules)\//.test(file)
  );
}

export function isCode(file: string): boolean {
  return /\.(?:tsx?|jsx|mjs|cjs|js)$/.test(file);
}

export function isUi(file: string): boolean {
  return /^(?:ui|apps|client|kits)\//.test(file);
}

/** The shared menu component is the only place that may listen for the native event. */
export function isMenuImplementation(file: string): boolean {
  return /(?:^|\/)ui\/src\/Menu(?:\/|$)/.test(file) || /(?:^|\/)ui\/src\/Menu\.(?:tsx|ts|jsx|js)$/.test(file);
}

const LIST_TYPES = new Set([
  "sites",
  "forms",
  "campaigns",
  "automations",
  "agents",
  "records",
  "vault",
  "channels",
  "runbooks",
  "terminals",
  "files",
]);

/** Place folder for a type that ARCH 4.12 organises with ListSections, when the file is a sidebar. */
export function listedSidebarType(file: string): string | null {
  const m = /(?:^|\/)apps\/app\/src\/places\/([^/]+)\/[^/]*Sidebar[^/]*\.(?:tsx|jsx)$/.exec(file);
  if (!m) return null;
  const place = m[1];
  return LIST_TYPES.has(place) ? place : null;
}
