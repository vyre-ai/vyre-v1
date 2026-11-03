// Mount for SITESREADY_01: Apps on Sites with sites Vyre deploys. ?view=list (the default), detail (a live CX dashboard with its deploys, env vars and Postgres), building (its build log
// streaming), failed (a deploy that needs Postgres, with its one fix), new (the New site sheet). Made-up data on the sample replica.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import AppsLayout from "../../../apps/app/src/places/apps/shell/index.ts";
import type { AppsRoute } from "../../../apps/app/src/places/apps/shell/index.ts";
import { createSampleApps, SAMPLE_NOW } from "../../../apps/app/src/places/apps/shell/sample.ts";

export const title = "Sites ready";
const M = 60_000;
const base = { kind: "app", owner: "usr_anem", access: "space", blocked: false, deployed: true, limits: { cpus: 1, memoryMb: 512 }, autoDeploy: true } as const;
const dep = (id: string, o: Record<string, unknown>) => ({ deploymentId: id, siteId: "sit_cx", env: "production", at: SAMPLE_NOW - 5 * M, by: "usr_anem", ...o });

function sites(view: string) {
  const cx = {
    ...base, siteId: "sit_cx", name: "CX dashboard", slug: "cx", url: "https://cx.mla.vyre.run", port: 3000, live: true,
    state: view === "building" ? "building" : "ready", source: { repo: "https://github.com/mla/cx-dashboard.git", branch: "main" },
    addons: [{ kind: "postgres", state: "ready", envName: "DATABASE_URL" }], passwordSet: false,
    lastDeploy: view === "building" ? dep("dpl_3", { state: "building", note: "Node: npm ci, npm run build, then npm start (from railway.json, package.json)." })
      : view === "failed" ? dep("dpl_3", { state: "failed", finishedAt: SAMPLE_NOW - 2 * M, commit: "4be1c0a9e2d14b6f8a0c3d5e7f9a1b2c3d4e5f60", problem: "It needs a Postgres database and has none. Add one: it gets DATABASE_URL.", fix: "add_postgres" })
      : dep("dpl_2", { state: "ready", finishedAt: SAMPLE_NOW - 4 * M, commit: "9f3e21c7aa0b4c1d8e2f3a4b5c6d7e8f90a1b2c3", current: true, note: "Node: npm ci, npm run build, then npm start (from railway.json, package.json)." }),
  };
  if (view === "failed") Object.assign(cx, { addons: [] });
  return [
    cx,
    { ...base, siteId: "sit_kpi", name: "Weekly KPIs", slug: "kpi", url: "https://kpi.mla.vyre.run", live: true, state: "ready", access: "password", source: { fileId: "fil_zip" }, addons: [], lastDeploy: { deploymentId: "dpl_k", siteId: "sit_kpi", env: "production", state: "ready", at: SAMPLE_NOW - 26 * 60 * M, finishedAt: SAMPLE_NOW - 26 * 60 * M, by: "usr_rubab", current: true } },
    { ...base, siteId: "sit_api", name: "Intake API", slug: "intake-api", url: "https://intake-api.mla.vyre.run", live: false, state: "failed", source: { repo: "mla/intake-api" }, addons: [], lastDeploy: { deploymentId: "dpl_a", siteId: "sit_api", env: "production", state: "failed", at: SAMPLE_NOW - 50 * M, finishedAt: SAMPLE_NOW - 48 * M, by: "usr_anem", problem: "It stopped because STRIPE_KEY is not set. Add it from the Vault.", fix: "set_env" } },
    { siteId: "sit_north", name: "Northwind site", kind: "site", owner: "usr_irfad", state: "stopped", live: false, access: "public", slug: "northwind", folderId: "fld_n" },
  ];
}

const BUILD = ["==> Getting mla/cx-dashboard (main)", "==> Commit 4be1c0a: Show refund requests on the queue", "==> Node: npm ci, npm run build, then npm start (from railway.json, package.json).", "==> Building", "Step 1/15 : ARG NODE_IMAGE=node:24-alpine", "Step 2/15 : FROM ${NODE_IMAGE}", " ---> 7c4e6f1d2a3b", "Step 9/15 : RUN echo \"lock ${LOCK_HASH}\" > /dev/null && sh -c \"$INSTALL_CMD\"", "added 412 packages in 9s", "Step 11/15 : RUN if [ -n \"$BUILD_CMD\" ]; then sh -c \"$BUILD_CMD\"; fi", "> cx-dashboard@1.4.0 build", "> next build", "   Creating an optimized production build ...", " ✓ Compiled successfully in 14.2s", "   Collecting page data ..."];
const APP = ["> cx-dashboard@1.4.0 start", "> next start", "   ▲ Next.js 15.3.3", "   - Local:        http://localhost:3000", " ✓ Ready in 412ms", "GET /queue 200 in 38ms", "GET /api/tickets?status=open 200 in 61ms"];

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  const view = q?.get("view") ?? "list";
  const data = useMemo(() => {
    if (q === null) return null;
    const rows = sites(view);
    const s = createSampleApps({ deferred: [], sites: rows as never });
    const names: Record<string, string> = { usr_anem: "Anem Fatima", usr_rubab: "Rubab Ali", usr_irfad: "Irfad Imtiaz" };
    const call = s.data.call;
    const deps = view === "failed"
      ? [dep("dpl_3", { state: "failed", finishedAt: SAMPLE_NOW - 2 * M, commit: "4be1c0a9e2d14b6f8a0c3d5e7f9a1b2c3d4e5f60", problem: "It needs a Postgres database and has none." }), dep("dpl_2", { state: "ready", at: SAMPLE_NOW - 3 * 60 * M, finishedAt: SAMPLE_NOW - 3 * 60 * M, commit: "9f3e21c7aa0b4c1d8e2f3a4b5c6d7e8f90a1b2c3", current: true })]
      : [dep("dpl_2", { state: view === "building" ? "ready" : "ready", finishedAt: SAMPLE_NOW - 4 * M, commit: "9f3e21c7aa0b4c1d8e2f3a4b5c6d7e8f90a1b2c3", current: true }), dep("dpl_1", { state: "ready", at: SAMPLE_NOW - 26 * 60 * M, finishedAt: SAMPLE_NOW - 26 * 60 * M, by: "usr_rubab", commit: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b" })];
    const answers: Record<string, (i: Record<string, unknown>) => unknown> = {
      "sites.list": () => ({ sites: rows }),
      "sites.get": (i) => ({ site: rows.find((r) => r.siteId === i["siteId"]) }),
      "sites.status": () => ({ answering: true, live: true, blocked: false, url: "https://cx.mla.vyre.run" }),
      "sites.host": () => ({ origin: "https://mla.vyre.run", relay: false, computers: false, domains: true, deploy: true, sitesDomain: "mla.vyre.run" }),
      "sites.domains_get": () => ({ domains: [] }),
      "sites.deployments": () => ({ deployments: view === "building" ? [dep("dpl_3", { state: "building" }), ...deps] : deps, total: 2 }),
      "sites.env_list": () => ({ entries: [{ name: "GHL_API_KEY", vaultName: "#GHL_CX", injected: true }, { name: "SESSION_SECRET", vaultName: "#CX_Session", injected: true }], wanted: view === "failed" ? ["SLACK_WEBHOOK"] : [] }),
      "sites.logs": (i) => ({ lines: i["build"] ? BUILD : APP, state: view === "building" ? "building" : "ready" }),
      "vault.items.list": () => ({ items: [{ handle: "#GHL_CX", name: "GHL CX key" }, { handle: "#CX_Session", name: "CX session secret" }, { handle: "#Railway_DB", name: "Railway database" }, { handle: "#GitHub_MLA", name: "GitHub token (MLA)" }], counts: {} }),
    };
    s.data.call = async (cap, input) => { const a = answers[cap]; return a ? a(input as Record<string, unknown>) : call(cap, input); };
    s.data.nameOf = (id) => names[id] ?? id;
    s.data.me = { id: "usr_anem", name: "Anem Fatima" };
    (s.data as unknown as { peek?: unknown }).peek = undefined;
    return s.data;
  }, [q, view]);
  useEffect(() => {
    if (view !== "new") return undefined;
    const t = setTimeout(() => { ((globalThis as { document?: Document }).document?.querySelector("[data-testid='apps-new-site']") as HTMLElement | null)?.click(); }, 400);
    return () => clearTimeout(t);
  }, [view, data]);
  if (data === null) return <View style={{ flex: 1 }} />;
  const route: AppsRoute = view === "detail" || view === "building" || view === "failed" ? { kind: "detail", group: "sites", id: "sit_cx" } : { kind: "list" };
  return <View style={{ flex: 1, minHeight: 0 }}><AppsLayout data={data} route={route} /></View>;
}
