// Agent workspaces on more than one machine (6 Nov). A workspace lives on one machine, with its volumes: the Space's own container runtime where it has one, else a server that joined the Space
// (a person's own server on a Personal Space, a compute server on a Team one). Each machine has a manager of its own (workspace.ts); the fleet is the one manager the terminal sees, sending each agent
// to the machine its workspace is on. The Docker questions for a node travel over its live socket (`remoteDockerHttp`), and the node puts them to its own Docker through the runner's policy.
import type { DockerHttp, DockerRequest, DockerResponse } from "../../sandbox/src/docker.ts";
import type { WorkspaceManager, WorkspaceRow, WorkspaceStatus } from "./workspace.ts";

/** Bytes of a body in one frame of the node's socket once base64 has grown them (host/src/compute/docker-ask.ts CHUNK); a larger one travels in pieces of this size. */
export const CHUNK = 2_000_000;
/** The most a body may hold in all its pieces (host/src/compute/docker-ask.ts MAX_TOTAL). */
export const MAX_LINK_BODY = 300 * 1024 * 1024;

/** A DockerHttp whose engine is on a node: each request is a question over the node's socket, and a body larger than one frame goes in pieces, staged on the node before the request that uses it; an answer larger than one frame comes back in pieces. */
export function remoteDockerHttp(ask: (input: unknown, timeoutMs: number) => Promise<unknown>): DockerHttp {
  type Answer = { status?: number; bodyB64?: string; more?: { id: string; chunks: number } } | null;
  const rid = (): string =>
    Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  return async (req: DockerRequest): Promise<DockerResponse> => {
    const body = req.json !== undefined ? undefined : req.body;
    if (body && body.length > MAX_LINK_BODY) throw new Error("That is too large to send to the server.");
    const timeoutMs = req.timeoutMs ?? 60_000;
    let bodyPart: Record<string, unknown> = {};
    if (req.json !== undefined) bodyPart = { jsonText: JSON.stringify(req.json) };
    else if (body && body.length > CHUNK) {
      const id = rid();
      const total = Math.ceil(body.length / CHUNK);
      for (let i = 0; i < total; i++)
        await ask(
          {
            method: "PUT",
            path: "/",
            stage: { id, index: i, total },
            bodyB64: Buffer.from(body.subarray(i * CHUNK, (i + 1) * CHUNK)).toString("base64"),
          },
          30_000,
        );
      bodyPart = { stagedId: id };
    } else if (body) bodyPart = { bodyB64: Buffer.from(body).toString("base64") };
    const input = {
      method: req.method,
      path: req.path,
      ...(req.query ? { query: req.query } : {}),
      ...bodyPart,
      ...(req.contentType ? { contentType: req.contentType } : {}),
      timeoutMs,
    };
    const out = (await ask(input, timeoutMs + 10_000)) as Answer;
    if (!out || typeof out.status !== "number") throw new Error("The server did not answer for Docker.");
    const parts: Buffer[] = [Buffer.from(out.bodyB64 ?? "", "base64")];
    if (out.more)
      for (let i = 1; i < out.more.chunks; i++) {
        const piece = (await ask({ method: "GET", path: "/", chunk: { id: out.more.id, index: i } }, 30_000)) as Answer;
        if (!piece || typeof piece.status !== "number")
          throw new Error("The server did not finish its answer for Docker.");
        parts.push(Buffer.from(piece.bodyB64 ?? "", "base64"));
      }
    return { status: out.status, body: new Uint8Array(Buffer.concat(parts)) };
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

/** True on either kind of Space (12 Nov, in the voice of the browser's line, lane f-desktop): the computer this Space runs on is the person's own in a Personal Space and the Space's server in a Team one. */
export const NO_PLACE =
  "This Space can't run agent workspaces yet. That needs Docker on the computer this Space runs on, or a server with Docker added in Console > Computers.";

export function createWorkspaceFleet(o: FleetOptions): WorkspaceFleet {
  const homes = new Map<string, WorkspaceManager>();
  const nodes = new Map<string, WorkspaceManager>();
  const nodeOf = (id: string): WorkspaceManager => {
    let m = nodes.get(id);
    if (!m) {
      m = o.node(id);
      nodes.set(id, m);
    }
    return m;
  };
  const all = (): WorkspaceManager[] => [...(o.space ? [o.space] : []), ...nodes.values()];
  const has = async (m: WorkspaceManager, agentId: string): Promise<boolean> =>
    (await m.list().catch(() => [] as WorkspaceRow[])).some((r) => r.agentId === agentId);

  /** Where an agent's workspace is: where it already is, else the Space's runtime, else the server it is placed on. */
  async function managerFor(agentId: string): Promise<WorkspaceManager> {
    const known = homes.get(agentId);
    if (known) return known;
    let pick: WorkspaceManager | undefined;
    if (o.space && (await has(o.space, agentId))) pick = o.space;
    // a placement that cannot be read (an agent in Trash has no owner to ask for) is no server: the Space runtime decides, and its admission refuses what it must
    const node = pick ? null : await o.place(agentId).catch(() => null);
    if (!pick && node !== null && (await has(nodeOf(node), agentId))) pick = nodeOf(node);
    if (!pick && o.space) pick = o.space;
    if (!pick && node !== null) pick = nodeOf(node);
    if (!pick) throw Object.assign(new Error(NO_PLACE), { code: "unavailable", workspace: true });
    homes.set(agentId, pick);
    return pick;
  }

  /** The machines an agent's workspace is on now: the one it is known on, else every one that has it. Nothing is placed. */
  const where = async (agentId: string): Promise<WorkspaceManager[]> => {
    const known = homes.get(agentId);
    return known
      ? [known]
      : (await Promise.all(all().map(async (m) => ((await has(m, agentId)) ? m : null)))).filter(
          (m): m is WorkspaceManager => m !== null,
        );
  };

  return {
    async status(agentId): Promise<WorkspaceStatus> {
      const nodeIdOf = (m: WorkspaceManager): string | undefined => [...nodes].find(([, x]) => x === m)?.[0];
      const known = homes.get(agentId);
      const tag = (m: WorkspaceManager, st: WorkspaceStatus): WorkspaceStatus => {
        const n = nodeIdOf(m);
        return { ...st, host: n === undefined ? "space" : "server", ...(n === undefined ? {} : { nodeId: n }) };
      };
      if (known) return tag(known, await known.status(agentId));
      // no machine that answers: it cannot run, which is not "not made yet"
      let answered = false;
      for (const m of all()) {
        const st = await m.status(agentId).catch(() => null);
        if (st) answered = true;
        if (st && st.state !== "none") return tag(m, st);
      }
      if (!answered)
        throw Object.assign(new Error("No machine for workspaces answers."), { code: "unavailable", workspace: true });
      return { state: "none" };
    },
    async available(agentId) {
      return o.space !== null || (homes.has(agentId) ? true : (await o.place(agentId).catch(() => null)) !== null);
    },
    async ensure(agentId) {
      return (await managerFor(agentId)).ensure(agentId);
    },
    async provision(agentId) {
      return (await managerFor(agentId)).provision(agentId);
    },
    async exec(agentId, argv, x) {
      return (await managerFor(agentId)).exec(agentId, argv, x);
    },
    generation(agentId) {
      return homes.get(agentId)?.generation(agentId) ?? 0;
    },
    async sleep(agentId) {
      return (await managerFor(agentId)).sleep(agentId);
    },
    // a hold is taken after the run's wake, so the agent's machine is known by then
    hold(agentId) {
      return homes.get(agentId)?.hold(agentId) ?? (() => undefined);
    },
    worked(agentId) {
      homes.get(agentId)?.worked(agentId);
    },
    async freshen(agentId, ms) {
      const k = homes.get(agentId);
      return k ? k.freshen(agentId, ms) : true;
    },
    filesChanged(change) {
      for (const m of all()) m.filesChanged(change);
    },
    viewed(agentId) {
      const k = homes.get(agentId);
      for (const m of k ? [k] : all()) m.viewed(agentId);
    },
    async cut(agentId, projectId) {
      for (const m of await where(agentId)) await m.cut(agentId, projectId);
    },
    async revoke(agentId) {
      for (const m of await where(agentId)) await m.revoke(agentId);
    },
    restore(agentId) {
      for (const m of all()) m.restore(agentId);
    },
    async awake(agentId) {
      const m = homes.get(agentId);
      if (m) return m.awake(agentId);
      for (const x of all()) if (await x.awake(agentId).catch(() => false)) return true;
      return false;
    },
    // the health of the Space's own server: its own Docker (a server added in Console reports its own)
    async ready() {
      await Promise.all(all().map((m) => m.ready().catch(() => undefined)));
    },
    networkNote() {
      return o.space ? o.space.networkNote() : null;
    },
    async hostSubnets() {
      return o.space ? o.space.hostSubnets() : null;
    },
    subnets() {
      return [...new Set(all().flatMap((m) => m.subnets()))];
    },
    takeNote(agentId) {
      for (const m of all()) {
        const n = m.takeNote(agentId);
        if (n !== null) return n;
      }
      return null;
    },
    restartLine(agentId, since) {
      for (const m of all()) {
        const l = m.restartLine(agentId, since);
        if (l !== null) return l;
      }
      return null;
    },
    async sweep() {
      const out: string[] = [];
      for (const m of all()) out.push(...(await m.sweep().catch(() => [])));
      return out;
    },
    async list() {
      const rows: WorkspaceRow[] = [];
      for (const m of all()) rows.push(...(await m.list().catch(() => [])));
      return rows;
    },
    async find(session) {
      for (const m of all()) {
        const id = await m.find(session).catch(() => null);
        if (id !== null) {
          homes.set(id, m);
          return id;
        }
      }
      return null;
    },
    async remove(agentId, x) {
      // keeping the volumes (agent.deleted): only where its container is; nothing is made or placed for it
      if (x?.keepVolumes === true) {
        for (const m of await where(agentId)) await m.remove(agentId, x);
        homes.delete(agentId);
        return;
      }
      // the volumes too (the Trash pass, third look T1): the container went at agent.deleted, so it is asked of every machine, and of the server it was placed on; a volume that is not there
      // answers 404, which is fine. Any machine that does not answer throws, so the pass keeps the agent and tries again.
      const placed = await o.place(agentId).catch(() => null);
      const ms = new Set<WorkspaceManager>([...all(), ...(placed !== null ? [nodeOf(placed)] : [])]);
      const failed: unknown[] = [];
      for (const m of ms)
        await m.remove(agentId, x).catch((e: unknown) => {
          failed.push(e);
        });
      homes.delete(agentId);
      if (failed.length > 0) throw failed[0];
    },
    async health() {
      const hs = await Promise.all(all().map((m) => m.health().catch(() => ({ ok: false }))));
      if (hs.length === 0) return { ok: false, detail: NO_PLACE };
      return hs.some((h) => h.ok)
        ? { ok: true }
        : { ok: false, detail: (hs[0] as { detail?: string }).detail ?? "The container runtime did not answer." };
    },
    close() {
      for (const m of all()) m.close();
    },
  };
}
