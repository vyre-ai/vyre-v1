// What each hub or sign-in connection last did, so a key that stops working opens its one task once and a working call closes it once (never per call). A 401 means the key was revoked or the
// sign-in ended: the task goes to the admins (the connection is the Space's), says what to do in a line, and closes itself when the connection answers again.
import { connectionNeedsYou, connectionWorks } from "../../lib/needs-you.ts";
import { hubById } from "../../lib/mcp-hubs.ts";
import { engineHost } from "./runtime.ts";
import type { ServerSpec } from "./plugin-runtime.ts";

const standing = new Map<string, "ok" | "bad">();

/** The task is opened and closed as the host's own service actor, not as whoever's call it was, so whoever's call succeeds first closes it and the tasks rules stay as they are. */
export async function watchConnection(spec: ServerSpec, outcome: "ok" | { error: string }): Promise<void> {
  const id = spec.connectionId;
  const host = engineHost();
  if (!id || !host || (!spec.hub && !spec.oauth)) return;
  const call = (cap: string, input: unknown): Promise<unknown> => host.call(cap, input);
  const was = standing.get(id);
  if (outcome === "ok") {
    standing.set(id, "ok");
    if (was !== "ok") await connectionWorks(call, id);
    return;
  }
  if (!/answered 401/.test(outcome.error)) return;
  standing.set(id, "bad");
  if (was === "bad") return;
  const hub = hubById(spec.hub);
  await connectionNeedsYou(call, {
    id, title: hub ? `Replace the ${hub.name} key` : `Sign in to ${spec.name} again`,
    summary: hub ? "Stopped accepting the key. Apps through it are paused until it is replaced." : "Ended the sign-in.",
    to: { kind: "role", id: "admin" }, from: hub ? hub.name : spec.name, ...(hub ? { fix: "replace_key", notes: { hub: hub.id } } : {}),
  });
}
