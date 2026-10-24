// The route table (generated/routes.ts) as an index. All routes are exact method + path; the capability is named in the record.
export interface RouteRec { method: string; path: string; cap: string; v: number; effects: "read" | "write" | "outward" }

export function indexRoutes<R extends RouteRec>(routes: readonly R[]): (method: string, path: string) => R | undefined {
  const m = new Map<string, R>();
  for (const r of routes) {
    const k = `${r.method} ${r.path}`;
    if (m.has(k)) throw new Error(`duplicate route ${k}`);
    m.set(k, r);
  }
  return (method, path) => m.get(`${method.toUpperCase()} ${path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path}`);
}
