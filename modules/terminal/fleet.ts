// Agent workspaces on more than one machine (6 Nov). A workspace lives on one machine, with its volumes: the Space's own container runtime where it has one, else a server that joined the Space
// (a person's own server on a Personal Space, a compute server on a Team one). Each machine has a manager of its own (workspace.ts); the fleet is the one manager the terminal sees, sending each agent
// to the machine its workspace is on. The Docker questions for a node travel over its live socket (`remoteDockerHttp`), and the node puts them to its own Docker through the runner's policy.
import type { DockerHttp, DockerRequest, DockerResponse } from "../../sandbox/src/docker.ts";
import type { WorkspaceManager, WorkspaceRow } from "./workspace.ts";

/** Bytes of a body that fit one frame of the node's socket once base64 has grown them (host/src/compute/docker-ask.ts MAX_BODY). */
export const MAX_LINK_BODY = 2_500_000;

/** A DockerHttp whose engine is on a node: each request is one question over the node's socket. */
export function remoteDockerHttp(ask: (input: unknown, timeoutMs: number) => Promise<unknown>): DockerHttp {
  return async (req: DockerRequest): Promise<DockerResponse> => {
    const body = req.json !== undefined ? undefined : req.body;
    if (body && body.length > MAX_LINK_BODY) throw new Error("That is too large to send to the server.");
    const timeoutMs = req.timeoutMs ?? 60_000;
    const input = {
      method: req.method, path: req.path, ...(req.query ? { query: req.query } : {}),
      ...(req.json !== undefined ? { jsonText: JSON.stringify(req.json) } : body ? { bodyB64: Buffer.from(body).toString("base64") } : {}),
      ...(req.contentType ? { contentType: req.contentType } : {}), timeoutMs,
    };
    const out = (await ask(input, timeoutMs + 10_000)) as { status?: number; bodyB64?: string } | null;
    if (!out || typeof out.status !== "number") throw new Error("The server did not answer for Docker.");
    return { status: out.status, body: new Uint8Array(Buffer.from(out.bodyB64 ?? "", "base64")) };
  };
}

export interface FleetOptions {
  /** The Space's own manager, when it has a container runtime. */
  space: WorkspaceManager | null;
  /** The manager of a server that joined, made the first time it is needed. */
  node(nodeId: string): WorkspaceManager;
  /** The server this agent's workspace goes on when the Space has no runtime of its own (one that is connected and has Docker), or null. */
  place(agentId: string): Promise<string | null>;
}

export interface WorkspaceFleet extends WorkspaceManager {
  /** Is there a machine this agent's workspace can live on right now? */
  available(agentId: string): Promise<boolean>;
}

export const NO_PLACE = "There is no machine to run an agent workspace on. Install Docker on this computer, or add a server in Console > Computers.";

export function createWorkspaceFleet(o: FleetOptions): WorkspaceFleet {
  const homes = new Map<string, WorkspaceManager>();
  const nodes = new Map<string, WorkspaceManager>();
  const nodeOf = (id: string): WorkspaceManager => { let m = nodes.get(id); if (!m) { m = o.node(id); nodes.set(id, m); } return m; };
  const all = (): WorkspaceManager[] => [...(o.space ? [o.space] : []), ...nodes.values()];
  const has = async (m: WorkspaceManager, agentId: string): Promise<boolean> => (await m.list().catch(() => [] as WorkspaceRow[])).some((r) => r.agentId === agentId);

  /** Where an agent's workspace is: where it already is, else the Space's runtime, else the server it is placed on. */
  async function managerFor(agentId: string): Promise<WorkspaceManager> {
    const known = homes.get(agentId);
    if (known) return known;
    let pick: WorkspaceManager | undefined;
    if (o.space && (await has(o.space, agentId))) pick = o.space;
    const node = pick ? null : await o.place(agentId);
    if (!pick && node !== null && (await has(nodeOf(node), agentId))) pick = nodeOf(node);
    if (!pick && o.space) pick = o.space;
    if (!pick && node !== null) pick = nodeOf(node);
    if (!pick) throw Object.assign(new Error(NO_PLACE), { code: "unavailable", workspace: true });
    homes.set(agentId, pick);
    return pick;
  }

  return {
    async available(agentId) { return o.space !== null || (homes.has(agentId) ? true : (await o.place(agentId).catch(() => null)) !== null); },
    async ensure(agentId) { return (await managerFor(agentId)).ensure(agentId); },
    async provision(agentId) { return (await managerFor(agentId)).provision(agentId); },
    async exec(agentId, argv, x) { return (await managerFor(agentId)).exec(agentId, argv, x); },
    generation(agentId) { return homes.get(agentId)?.generation(agentId) ?? 0; },
    async sleep(agentId) { return (await managerFor(agentId)).sleep(agentId); },
    async sweep() { const out: string[] = []; for (const m of all()) out.push(...(await m.sweep().catch(() => []))); return out; },
    async list() { const rows: WorkspaceRow[] = []; for (const m of all()) rows.push(...(await m.list().catch(() => []))); return rows; },
    async find(session) { for (const m of all()) { const id = await m.find(session).catch(() => null); if (id !== null) { homes.set(id, m); return id; } } return null; },
    async remove(agentId) { await (await managerFor(agentId)).remove(agentId); homes.delete(agentId); },
    async health() {
      const hs = await Promise.all(all().map((m) => m.health().catch(() => ({ ok: false }))));
      if (hs.length === 0) return { ok: false, detail: NO_PLACE };
      return hs.some((h) => h.ok) ? { ok: true } : { ok: false, detail: (hs[0] as { detail?: string }).detail ?? "The container runtime did not answer." };
    },
    close() { for (const m of all()) m.close(); },
  };
}
