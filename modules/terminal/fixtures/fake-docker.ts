// A stand-in for the Docker Engine API for the workspace tests: just the calls modules/terminal/workspace.ts makes (containers, exec, volumes, networks, images), through the real createDockerApi.
// A container keeps its own stand-in tmux, which is lost when the container stops, like the real thing. Nothing here spawns a process or opens a socket.
import type { DockerHttp, DockerRequest, DockerResponse } from "../../../sandbox/src/docker.ts";
import type { ExecResult } from "../impl.ts";
import { fakeTmux } from "./fake-tmux.ts";
import type { FakeTmux, FakeTmuxOptions } from "./fake-tmux.ts";

interface Box { name: string; config: Record<string, any>; running: boolean; tmux: FakeTmux; starts: number }   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FakeDockerOptions {
  /** The image is on the machine. Default true. */
  image?: boolean;
  /** A pull succeeds. Default false. */
  pullWorks?: boolean;
  tmux?: FakeTmuxOptions;
  /** The first look at an exec: return a result to answer it, or undefined to let the stand-in tmux (or "not found") answer. */
  onExec?: (box: string, argv: readonly string[], env: readonly string[]) => ExecResult | undefined;
  /** What `tmux list-panes` prints in a box. */
  panes?: (box: string) => string;
}

const frame = (kind: 1 | 2, text: string): Uint8Array => {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(8 + body.length);
  out[0] = kind;
  new DataView(out.buffer).setUint32(4, body.length);
  out.set(body, 8);
  return out;
};
const cat = (...parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const json = (status: number, v: unknown): DockerResponse => ({ status, body: new TextEncoder().encode(JSON.stringify(v)) });
const empty = (status: number): DockerResponse => ({ status, body: new Uint8Array(0) });

export function fakeDocker(o: FakeDockerOptions = {}) {
  const boxes = new Map<string, Box>();
  const volumes = new Map<string, Record<string, unknown>>();
  const networks = new Set<string>();
  const log: Array<{ op: string; name?: string; detail?: unknown }> = [];
  const execs = new Map<string, ExecResult>();
  let image = o.image !== false;
  let execSeq = 0;
  let helperExit = 0;

  const note = (op: string, name?: string, detail?: unknown): void => { log.push({ op, ...(name === undefined ? {} : { name }), ...(detail === undefined ? {} : { detail }) }); };

  async function runExec(b: Box, argv: readonly string[], env: readonly string[]): Promise<ExecResult> {
    note("exec", b.name, argv);
    const given = o.onExec?.(b.name, argv, env);
    if (given) return given;
    if (argv[0] === "tmux" && argv[1] === "new-session" && argv.includes("-A")) {
      const rest = argv.filter((a) => a !== "-A");
      const name = rest[rest.indexOf("-s") + 1] as string;
      return b.tmux.sessions.has(name) ? { code: 0, stdout: "", stderr: "" } : b.tmux.exec(rest);
    }
    if (argv[0] === "tmux" && argv[1] === "list-panes") return { code: 0, stdout: o.panes?.(b.name) ?? [...b.tmux.sessions.keys()].map(() => "bash").join("\n"), stderr: "" };
    if (argv[0] === "tmux" && argv[1] === "pipe-pane") return { code: 0, stdout: "", stderr: "" };
    return b.tmux.exec(argv);
  }

  const http: DockerHttp = async (req: DockerRequest): Promise<DockerResponse> => {
    const p = req.path;
    const m = req.method;
    if (p === "/_ping") return { status: 200, body: new TextEncoder().encode("OK") };
    let r = /^\/images\/(.+)\/json$/.exec(p);
    if (r && m === "GET") return image ? json(200, {}) : json(404, { message: "no such image" });
    if (p === "/images/create" && m === "POST") { note("pull", undefined, req.query); if (o.pullWorks === true) { image = true; return empty(200); } return json(404, { message: "pull access denied" }); }
    if (p === "/containers/json" && m === "GET") {
      const all = req.query?.["all"] === "true";
      const rows = [...boxes.values()].filter((b) => (all || b.running) && b.config["Labels"]?.["vyre.workspace"] !== undefined).map((b) => ({ Names: [`/${b.name}`], State: b.running ? "running" : "exited", Labels: b.config["Labels"] }));
      return json(200, rows);
    }
    if (p === "/containers/create" && m === "POST") {
      const name = req.query?.["name"] as string;
      if (boxes.has(name)) return json(409, { message: "name in use" });
      boxes.set(name, { name, config: req.json as Record<string, any>, running: false, tmux: fakeTmux(o.tmux), starts: 0 });   // eslint-disable-line @typescript-eslint/no-explicit-any
      note("create", name, req.json);
      return json(201, { Id: `id_${name}` });
    }
    r = /^\/containers\/([^/]+)(?:\/(json|start|stop|wait))?$/.exec(p);
    if (r) {
      const name = r[1] as string;
      const b = boxes.get(name);
      const act = r[2] ?? (m === "DELETE" ? "remove" : "");
      if (!b) return json(404, { message: "no such container" });
      if (act === "json") return json(200, { State: { Running: b.running }, Config: { Labels: b.config["Labels"] ?? {} } });
      if (act === "start") { if (!b.running) { b.running = true; b.starts += 1; b.tmux = fakeTmux(o.tmux); } note("start", name); return empty(204); }
      if (act === "stop") { b.running = false; note("stop", name); return empty(204); }
      if (act === "wait") { note("wait", name); return json(200, { StatusCode: helperExit }); }
      if (act === "remove") { boxes.delete(name); note("remove", name); return empty(204); }
    }
    r = /^\/containers\/([^/]+)\/exec$/.exec(p);
    if (r && m === "POST") {
      const b = boxes.get(r[1] as string);
      if (!b || !b.running) return json(409, { message: "container is not running" });
      const body = req.json as { Cmd: string[]; Env: string[] };
      const id = `exe${String(++execSeq).padStart(61, "0")}`;
      execs.set(id, await runExec(b, body.Cmd, body.Env));
      return json(201, { Id: id });
    }
    r = /^\/exec\/([^/]+)\/start$/.exec(p);
    if (r && m === "POST") { const e = execs.get(r[1] as string) as ExecResult; return { status: 200, body: cat(frame(1, e.stdout), frame(2, e.stderr)) }; }
    r = /^\/exec\/([^/]+)\/json$/.exec(p);
    if (r && m === "GET") return json(200, { ExitCode: (execs.get(r[1] as string) as ExecResult).code });
    r = /^\/volumes\/([^/]+)$/.exec(p);
    if (r && m === "GET") return volumes.has(r[1] as string) ? json(200, { Name: r[1] }) : json(404, { message: "no such volume" });
    if (p === "/volumes/create" && m === "POST") { const v = req.json as { Name: string }; volumes.set(v.Name, v as Record<string, unknown>); note("volume", v.Name); return json(201, { Name: v.Name }); }
    if (r && m === "DELETE") { volumes.delete(r[1] as string); note("volume_remove", r[1]); return empty(204); }
    if (p === "/networks/create" && m === "POST") { networks.add((req.json as { Name: string }).Name); note("network", (req.json as { Name: string }).Name); return json(201, { Id: "net" }); }
    r = /^\/networks\/([^/]+)$/.exec(p);
    if (r && m === "DELETE") { networks.delete(r[1] as string); return empty(204); }
    return json(404, { message: `the stand-in does not know ${m} ${p}` });
  };

  return {
    http, boxes, volumes, networks, log,
    ops(op: string): Array<{ op: string; name?: string; detail?: unknown }> { return log.filter((l) => l.op === op); },
    box(name: string): Box { return boxes.get(name) as Box; },
    setImage(v: boolean) { image = v; },
    /** The container stops without Vyre asking (someone ran docker stop). */
    kill(name: string) { const b = boxes.get(name); if (b) b.running = false; },
    helperFails() { helperExit = 1; },
  };
}
export type FakeDocker = ReturnType<typeof fakeDocker>;
