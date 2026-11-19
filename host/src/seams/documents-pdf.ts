// The host half of the documents module's Word-to-PDF step (lane r42-docs). The module exports `hostSeams = { configureDocuments }` and the daemon hands it this. It runs LibreOffice
// (soffice) on this machine, in a folder of its own with its own profile, when the machine has it; a machine without it hands the module no converter, and the module sets the
// words in its plain page look instead (so a Space with nothing installed still gets a PDF). A converter that is there and fails throws, and the module falls back the same way.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findDockerSocket } from "./docker-socket.ts";
import { converterImage, createDocConverter, socketEngine } from "./doc-converter.ts";
import type { ConverterState, Engine } from "./doc-converter.ts";

export interface DocumentsHostSeam {
  pdf?(docx: Uint8Array): Promise<Uint8Array>;
  /** how the exact converter stands: ready, pulling (being fetched), failed, none (no engine, no LibreOffice) */
  state?(): string;
}
export interface DocumentsPdfDeps {
  /** the soffice to run; omitted: VYRE_SOFFICE, then soffice or libreoffice on the PATH, then the usual places */
  soffice?: string;
  /** the folder scratch folders are made in; omitted: the system's */
  tmp?: string;
  /** most the converter may take, in ms (default 60 000) */
  timeoutMs?: number;
  /** a Team server: the sites runner's socket and its token (read again on each call), which alone holds the Docker socket; its policy lets only the converter image run (converter-policy.ts) */
  runner?: { socket: string; token(): string };
  /** the Docker engine, for tests (default: the first socket that answers) */
  engine?: Engine;
  image?: string;
  onState?: (s: ConverterState, why?: string) => void;
  /** a way to run the program, for tests */
  run?: (
    file: string,
    args: string[],
    o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
  ) => Promise<{ code: number; stderr: string }>;
}

const PLACES = [
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/bin/libreoffice",
  "/opt/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

/** The converter on this machine, or null. */
export function findSoffice(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = fs.existsSync,
): string | null {
  const named = env.VYRE_SOFFICE;
  if (named && exists(named)) return named;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const bin of ["soffice", "libreoffice"]) {
      const p = path.join(dir, bin);
      if (exists(p)) return p;
    }
  }
  return PLACES.find((p) => exists(p)) ?? null;
}

const execRun: NonNullable<DocumentsPdfDeps["run"]> = (file, args, o) =>
  new Promise((resolve) => {
    execFile(file, args, { cwd: o.cwd, env: o.env, timeout: o.timeoutMs, maxBuffer: 1 << 20 }, (err, _out, stderr) => {
      const code = err
        ? typeof (err as { code?: unknown }).code === "number"
          ? (err as { code: number }).code
          : 1
        : 0;
      resolve({ code, stderr: String(stderr).slice(0, 400) });
    });
  });

/** The seam: with no soffice on this machine it has no `pdf`, and the module uses its plain page look. */
export function createDocumentsHost(deps: DocumentsPdfDeps = {}): DocumentsHostSeam {
  const soffice = deps.soffice ?? findSoffice();
  if (!soffice) {
    // no LibreOffice on this machine: the converter image, through a Docker engine, when one answers (fetched on the first Word file)
    const sock = deps.engine === undefined && !deps.runner ? findDockerSocket() : { path: "", runtime: "test" };
    if (!sock && deps.engine === undefined) return { state: () => "none" };
    const runner = deps.runner;
    const conv = createDocConverter({
      engine:
        deps.engine ??
        (runner
          ? socketEngine(runner.socket, () => ({ authorization: `Bearer ${runner.token()}` }))
          : socketEngine(sock!.path)),
      image: deps.image ?? converterImage(),
      ...(deps.onState ? { onState: deps.onState } : {}),
    });
    return { pdf: (docx) => conv.pdf(docx), state: () => conv.state() };
  }
  const run = deps.run ?? execRun;
  const timeoutMs = deps.timeoutMs ?? 60_000;
  // one conversion at a time: LibreOffice answers a second call into a busy profile with nothing
  let queue: Promise<unknown> = Promise.resolve();
  const convert = async (docx: Uint8Array): Promise<Uint8Array> => {
    const dir = fs.mkdtempSync(path.join(deps.tmp ?? os.tmpdir(), "vyre-docpdf-"));
    try {
      const input = path.join(dir, "in.docx");
      fs.writeFileSync(input, docx);
      const profile = path.join(dir, "profile");
      const res = await run(
        soffice,
        [
          `-env:UserInstallation=file://${profile}`,
          "--headless",
          "--norestore",
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          input,
        ],
        { cwd: dir, env: { PATH: process.env.PATH ?? "", HOME: dir }, timeoutMs },
      );
      const out = path.join(dir, "in.pdf");
      if (res.code !== 0 || !fs.existsSync(out))
        throw new Error(`the PDF converter did not finish (${res.code}) ${res.stderr}`.trim());
      const bytes = new Uint8Array(fs.readFileSync(out));
      if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-")
        throw new Error("the PDF converter made something that is not a PDF");
      return bytes;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  return {
    pdf(docx) {
      const next = queue.then(() => convert(docx));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
