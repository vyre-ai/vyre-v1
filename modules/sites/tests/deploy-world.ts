// The sites world the deploy tests share: the real handlers over a real SQLite with the sites migrations, the container runner faked (no Docker), and the source fetcher stood in for.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { configureRoutes } from "../handlers/route.ts";
import { _test } from "../handlers/release.ts";
import { handlers } from "../impl.ts";
import { harness as base } from "../fixtures/world.ts";

export const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "sites",
  "static",
);
export const h = handlers as unknown as Record<string, (ctx: unknown, input: unknown) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Fake {
  /** how long the build takes; a cancel ends it at once */
  buildMs?: number;
  failBuild?: boolean;
  /** a build that does not stop when it is canceled (a step the engine cannot cut off) */
  uncuttable?: boolean;
  /** Files, as the caller: answers the files.* calls a site's uploaded source makes (a folder's listing, a file's version). */
  files?: (cap: string, input: unknown) => unknown;
  /** The fingerprint the stand-in fetcher says it read for an uploaded source. */
  fetchFp?: () => string | undefined;
  /** What the Vault answers for a variable, by its name (the value a stored key fills in). */
  values?: Record<string, string>;
}

export function world(o: Fake = {}) {
  const w = base();
  const db = new DatabaseSync(":memory:");
  for (const f of [
    "0001_sites_core.sql",
    "0002_promote_tables.sql",
    "0003_routes.sql",
    "0004_deploy.sql",
    "0005_deploy_steps.sql",
    "0006_env_plain.sql",
    "0007_webhook.sql",
    "0009_hook_failures.sql",
    "0013_hook_order.sql",
    "0014_hook_seq.sql",
    "0015_built_from.sql",
  ])
    db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const sdb = {
    all: (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])),
    run: (sql: string, ...a: unknown[]) => ({ changes: Number(db.prepare(sql).run(...(a as never[])).changes) }),
  };
  let clock = Date.now();
  // a call from a handler to another capability goes to that handler (sites_ship composes the others); any other capability answers nothing
  const ctx: any = {
    ...w.ctx,
    db: sdb,
    now: () => ++clock,
    // a sealed value that opens again (the harness's stub seals to nothing)
    seal: {
      seal: (v: Uint8Array) => ({ keyId: "k", nonce: "n", bytes: Buffer.from(v).toString("base64") }),
      unseal: (s: { bytes: string }) => new Uint8Array(Buffer.from(s.bytes, "base64")),
    },
    call: async (cap: string, inp: unknown) =>
      cap.startsWith("files.") && fake.files ? fake.files(cap, inp) : h[cap] ? h[cap]!(ctx, inp) : {},
  }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const seen = {
    builds: 0,
    cut: 0,
    removed: [] as string[],
    running: [] as string[],
    envs: {} as Record<string, Record<string, string>>,
    images: [] as string[],
    droppedImages: [] as string[],
  };
  const fake = { ...o };
  const hooks = { hostRoute: (async () => undefined) as (...a: unknown[]) => Promise<void> };
  const runner = {
    ping: async () => true,
    freeMb: async () => 50_000,
    async build(a: { deploymentId: string; onLine(l: string): void; signal?: AbortSignal }) {
      seen.builds++;
      a.onLine("Step 1/2 : FROM caddy:2-alpine");
      if (fake.uncuttable) await new Promise<void>((res) => setTimeout(res, fake.buildMs ?? 300));
      else if (fake.buildMs)
        await new Promise<void>((res) => {
          const t = setTimeout(res, fake.buildMs);
          a.signal?.addEventListener(
            "abort",
            () => {
              seen.cut++;
              clearTimeout(t);
              res();
            },
            { once: true },
          );
        });
      if (a.signal?.aborted && !fake.uncuttable) return { ok: false as const, reason: "The build was canceled." };
      if (fake.failBuild) {
        a.onLine('npm ERR! Missing script: "build"');
        return { ok: false as const, reason: "The command returned a non-zero code: 1" };
      }
      a.onLine("Successfully built 4be1a09c77d2");
      return { ok: true as const, image: `img-${a.deploymentId}` };
    },
    network: async () => ({ name: "vyre-site-test", subnet: "10.250.0.0/28" }),
    removeNetwork: async () => undefined,
    async run(a: { deploymentId: string; env?: Record<string, string> }) {
      seen.running.push(`c-${a.deploymentId}`);
      seen.envs[a.deploymentId] = a.env ?? {};
      return { containerId: `c-${a.deploymentId}`, name: `vyre-site-${a.deploymentId}` };
    },
    address: async () => "10.250.0.2",
    state: async () => ({ running: true }),
    logs: async () => ["Serving on 3000"],
    remove: async (id: string) => void seen.removed.push(id),
    removeImage: async (i: string) => void seen.droppedImages.push(i),
    imageExists: async () => true,
    addon: async () => ({ containerId: "addon" }),
    removeAddon: async () => undefined,
    exec: async () => ({ code: 0, out: "PONG" }),
    put: async () => undefined,
  };
  configureRoutes({
    origin: () => ({ origin: "https://space.test", relay: false }),
    probe: async () => ({ answering: true }),
    runner,
    contained: false,
    tmp: os.tmpdir(),
    sitesDomain: () => "sites.test",
    domainOf: () => null,
    hostRoute: (...a: unknown[]) => hooks.hostRoute(...a),
    take: (ref: string) => fake.values?.[ref.slice(ref.indexOf(":") + 1)],
  } as never);
  const make = async (name: string): Promise<string> =>
    (await h["sites.create"]!(ctx, { name, source: { path: FIXTURE } })).site.siteId as string;
  // a repo site: its source is fetched by a stand-in that returns the static fixture with a commit (a repo cannot be cloned here)
  let n = 0;
  _test.useFetcher((async (s: { branch?: string }) => ({
    dir: FIXTURE,
    commit: `c0ffee${(++n).toString(16).padStart(2, "0")}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    message: `Change ${n}`,
    branch: s.branch ?? "main",
    ...(fake.fetchFp?.() ? { fp: fake.fetchFp() } : {}),
    cleanup: () => undefined,
  })) as never);
  const makeRepo = async (name: string, o: Record<string, unknown> = {}): Promise<string> =>
    (await h["sites.create"]!(ctx, { name, source: { repo: "https://github.com/acme/app.git", branch: "main" }, ...o }))
      .site.siteId as string;
  return {
    ctx,
    sdb,
    seen,
    fake,
    hooks,
    make,
    makeRepo,
    done: () => {
      _test.useFetcher(null);
      configureRoutes(null);
    },
  };
}
