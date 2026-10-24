// What the webview does once the shell has started vyred: GET the health route and require the vyred name.

import type { Health } from "./sidecar.ts";

export async function reachSidecar(base: string): Promise<Health> {
  const root = base.replace(/\/$/, "");
  const url = root.endsWith("/health") ? root : `${root}/health`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sidecar status ${res.status}`);
  const body = (await res.json()) as { ok?: unknown; name?: unknown; pid?: unknown };
  if (body.ok !== true || body.name !== "vyred" || typeof body.pid !== "number") {
    throw new Error("sidecar health rejected");
  }
  return { ok: true, name: "vyred", pid: body.pid };
}

export async function reachWeb(base: string): Promise<string> {
  const root = base.endsWith("/") ? base : `${base}/`;
  const res = await fetch(root);
  if (!res.ok) throw new Error(`web status ${res.status}`);
  return await res.text();
}
