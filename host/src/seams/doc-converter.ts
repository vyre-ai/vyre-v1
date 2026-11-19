// The exact Word to PDF copy, from the converter image (lane r42-docs). LibreOffice lives in its own small image (images/doc-converter), fetched the first time a Word file is turned into a PDF, the way agent images
// are, and never baked into vyred. Each conversion is one container: no network, no capabilities, a memory limit, a process limit; the .docx goes in through the Engine's archive endpoint, the PDF comes
// out the same way, and the container is removed whatever happened. It works wherever a Docker Engine answers (Linux servers, a Mac with Docker Desktop, Colima or OrbStack).
//
// The state of the converter is one small machine, and a conversion never waits on a fetch:
//   none      no Docker Engine answers on this machine: no exact copy here
//   idle      an engine answers, the image has not been asked for yet
//   pulling   the image is being fetched (started by the first conversion, which answers "pulling" at once; the caller sets the words in its plain look and says the exact copy is being made ready)
//   ready     the image is here: conversions run
//   failed    the fetch or a conversion failed; the next conversion after RETRY_MS tries again (never a loop)
import { randomBytes } from "node:crypto";
import http from "node:http";
import { releaseImage } from "./release-images.ts";

export type ConverterState = "none" | "idle" | "pulling" | "ready" | "failed";

export interface EngineRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  json?: unknown;
  body?: Uint8Array;
  contentType?: string;
  timeoutMs?: number;
}
export interface EngineResponse {
  status: number;
  body: Uint8Array;
}
export type Engine = (req: EngineRequest) => Promise<EngineResponse>;

export interface DocConverterDeps {
  engine: Engine;
  image: string;
  /** a failed fetch or conversion is tried again no sooner than this (default 5 minutes) */
  retryMs?: number;
  now?: () => number;
  /** called when the state changes, for the host's log and the module's words */
  onState?: (s: ConverterState, why?: string) => void;
}

/** The Engine API over a unix socket (a named pipe on Windows is not covered: the plain copy is used there). Behind a Team server's runner it is the runner's socket and the runner's token (`headers`).. */
export function socketEngine(socketPath: string, headers?: () => Record<string, string>): Engine {
  return (req) =>
    new Promise((resolve, reject) => {
      const qs = req.query ? `?${new URLSearchParams(req.query).toString()}` : "";
      const body = req.json !== undefined ? Buffer.from(JSON.stringify(req.json)) : req.body ? Buffer.from(req.body) : undefined;
      const r = http.request(
        {
          socketPath,
          method: req.method,
          path: `${req.path}${qs}`,
          headers: {
            ...(headers ? headers() : {}),
            ...(body ? { "content-length": String(body.length) } : {}),
            ...(req.json !== undefined ? { "content-type": "application/json" } : req.contentType ? { "content-type": req.contentType } : {}),
          },
          timeout: req.timeoutMs ?? 30_000,
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on("data", (d: Buffer) => parts.push(d));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: new Uint8Array(Buffer.concat(parts)) }));
        },
      );
      r.on("timeout", () => r.destroy(new Error("the Docker engine did not answer in time")));
      r.on("error", reject);
      if (body) r.write(body);
      r.end();
    });
}

// ---- a one-file tar, the archive endpoint's format ----

function octal(n: number, width: number): string {
  return `${n.toString(8).padStart(width - 1, "0")}\0`;
}
/** A tar with one regular file. */
export function tarOne(name: string, bytes: Uint8Array, uid = 10002, mode = 0o644): Uint8Array {
  const head = Buffer.alloc(512);
  head.write(name, 0, 100, "utf8");
  head.write(octal(mode, 8), 100);
  head.write(octal(uid, 8), 108);
  head.write(octal(uid, 8), 116);
  head.write(octal(bytes.length, 12), 124);
  head.write(octal(0, 12), 136);
  head.write("        ", 148);
  head.write("0", 156);
  head.write("ustar\0", 257);
  head.write("00", 263);
  let sum = 0;
  for (const b of head) sum += b;
  head.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const pad = (512 - (bytes.length % 512)) % 512;
  return new Uint8Array(Buffer.concat([head, Buffer.from(bytes), Buffer.alloc(pad + 1024)]));
}
/** The bytes of the first regular file in a tar, or null. */
export function untarFirst(tar: Uint8Array): Uint8Array | null {
  const b = Buffer.from(tar);
  for (let at = 0; at + 512 <= b.length; ) {
    const name = b.toString("utf8", at, at + 100).replace(/\0.*$/s, "");
    if (name === "") return null;
    const size = parseInt(b.toString("ascii", at + 124, at + 135).replace(/\0.*$/s, "").trim() || "0", 8);
    const type = String.fromCharCode(b[at + 156] ?? 48);
    if (Number.isNaN(size)) return null;
    if (type === "0" || type === "\0") return new Uint8Array(b.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

const text = (b: Uint8Array): string => Buffer.from(b).toString("utf8").slice(0, 300);

export interface DocConverter {
  state(): ConverterState;
  /** a filled .docx to the PDF the converter makes; throws while the image is being fetched or when it is not available, with the state in `.state` */
  pdf(docx: Uint8Array): Promise<Uint8Array>;
}

export class ConverterUnavailable extends Error {
  readonly state: ConverterState;
  constructor(state: ConverterState, message: string) {
    super(message);
    this.state = state;
  }
}

export function createDocConverter(d: DocConverterDeps): DocConverter {
  const now = d.now ?? Date.now;
  const retry = d.retryMs ?? 5 * 60_000;
  let state: ConverterState = "idle";
  let failedAt = 0;
  let pulling: Promise<void> | null = null;
  const set = (s: ConverterState, why?: string): void => {
    if (s === state && why === undefined) return;
    state = s;
    d.onState?.(s, why);
  };
  const has = async (): Promise<boolean> =>
    (await d.engine({ method: "GET", path: `/images/${encodeURIComponent(d.image)}/json` })).status === 200;
  const pull = (): Promise<void> => {
    set("pulling");
    const at = d.image.lastIndexOf(":");
    const query = d.image.includes("@") ? { fromImage: d.image } : { fromImage: d.image.slice(0, at), tag: d.image.slice(at + 1) };
    return d
      .engine({ method: "POST", path: "/images/create", query, timeoutMs: 15 * 60_000 })
      .then(async (r) => {
        if (r.status !== 200 || !(await has())) throw new Error(r.status === 200 ? "the image is not there after the fetch" : text(r.body));
        set("ready");
      })
      .catch((e: unknown) => {
        failedAt = now();
        set("failed", e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        pulling = null;
      });
  };

  const run = async (docx: Uint8Array): Promise<Uint8Array> => {
    const made = await d.engine({
      method: "POST",
      path: "/containers/create",
      // the name and label are what the runner's policy knows a converter by (host/src/sites-runner/converter-policy.ts)
      query: { name: `vyre-conv-${randomBytes(8).toString("hex")}` },
      json: {
        Labels: { "vyre.conv": "1" },
        Image: d.image,
        User: "10002:10002",
        NetworkDisabled: true,
        HostConfig: {
          NetworkMode: "none",
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges"],
          Memory: 1024 * 1024 * 1024,
          PidsLimit: 256,
          // /in and /out are the image's own folders (the archive endpoint cannot fill a tmpfs of a container that has not started); only /tmp, where LibreOffice keeps its profile, is memory
          Tmpfs: { "/tmp": "rw,size=256m,uid=10002,gid=10002" },
        },
      },
    });
    if (made.status !== 201) throw new Error(`the converter could not be made (${made.status}) ${text(made.body)}`);
    const id = (JSON.parse(Buffer.from(made.body).toString("utf8")) as { Id?: string }).Id;
    if (!id) throw new Error("the converter container has no id");
    try {
      const put = await d.engine({ method: "PUT", path: `/containers/${id}/archive`, query: { path: "/in" }, body: tarOne("in.docx", docx), contentType: "application/x-tar" });
      if (put.status !== 200) throw new Error(`the Word file could not be put in (${put.status}) ${text(put.body)}`);
      const start = await d.engine({ method: "POST", path: `/containers/${id}/start` });
      if (start.status !== 204 && start.status !== 304) throw new Error(`the converter did not start (${start.status}) ${text(start.body)}`);
      const done = await d.engine({ method: "POST", path: `/containers/${id}/wait`, timeoutMs: 120_000 });
      const code = (JSON.parse(Buffer.from(done.body).toString("utf8") || "{}") as { StatusCode?: number }).StatusCode;
      if (code !== 0) throw new Error(`the converter stopped with ${String(code)}`);
      const got = await d.engine({ method: "GET", path: `/containers/${id}/archive`, query: { path: "/out/in.pdf" } });
      const pdf = got.status === 200 ? untarFirst(got.body) : null;
      if (!pdf || Buffer.from(pdf.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new Error("the converter made no PDF");
      return pdf;
    } finally {
      await d.engine({ method: "DELETE", path: `/containers/${id}`, query: { force: "true", v: "true" } }).catch(() => undefined);
    }
  };

  // one conversion at a time: a second Word file waits its turn
  let queue: Promise<unknown> = Promise.resolve();

  return {
    state: () => state,
    async pdf(docx) {
      if (state === "none") throw new ConverterUnavailable("none", "No Docker engine answers on this machine, so there is no exact copy here.");
      if (state === "pulling") throw new ConverterUnavailable("pulling", "The converter is being fetched.");
      if (state === "failed" && now() - failedAt < retry) throw new ConverterUnavailable("failed", "The converter could not be fetched or run a moment ago.");
      if (state === "idle" || state === "failed") {
        let there = false;
        try {
          there = await has();
        } catch (e) {
          set("none", e instanceof Error ? e.message : String(e));
          throw new ConverterUnavailable("none", "No Docker engine answers on this machine, so there is no exact copy here.");
        }
        if (!there) {
          pulling ??= pull();
          throw new ConverterUnavailable("pulling", "The converter is being fetched.");
        }
        set("ready");
      }
      const next = queue.then(() => run(docx));
      queue = next.catch(() => undefined);
      try {
        return await next;
      } catch (e) {
        failedAt = now();
        set("failed", e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
  };
}

/** The image to ask for: VYRE_DOC_CONVERTER_IMAGE, else this release's own by version. */
export const converterImage = (env: NodeJS.ProcessEnv = process.env): string =>
  releaseImage("doc-converter", env["VYRE_VERSION"], env["VYRE_DOC_CONVERTER_IMAGE"]);
