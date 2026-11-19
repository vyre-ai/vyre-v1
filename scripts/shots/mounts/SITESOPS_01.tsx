// Mount for SITESOPS_01: a live site's Logs, its Right now numbers, a scheduled job with its runs, a worker that keeps crashing, and its database backups. Made-up data on the sample replica.
// ?view=overview (the default) opens the site; the target's steps open the tab or the row.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import AppsLayout from "../../../apps/app/src/places/apps/shell/index.ts";
import type { AppsRoute } from "../../../apps/app/src/places/apps/shell/index.ts";
import { createSampleApps, SAMPLE_NOW } from "../../../apps/app/src/places/apps/shell/sample.ts";

export const title = "Site operations";
const M = 60_000;
const site = {
  siteId: "sit_cx",
  name: "Storefront",
  kind: "app",
  owner: "usr_anem",
  access: "space",
  blocked: false,
  deployed: true,
  limits: { cpus: 1, memoryMb: 512 },
  autoDeploy: true,
  slug: "shop",
  url: "https://shop.northwind.vyre.run",
  port: 3000,
  live: true,
  state: "ready",
  source: { repo: "https://github.com/northwind/storefront.git", branch: "main" },
  addons: [{ kind: "postgres", state: "ready", envName: "DATABASE_URL" }],
  passwordSet: false,
  lastDeploy: {
    deploymentId: "dpl_2",
    siteId: "sit_cx",
    env: "production",
    state: "ready",
    at: SAMPLE_NOW - 2 * 60 * M,
    finishedAt: SAMPLE_NOW - 2 * 60 * M + 47_000,
    by: "usr_anem",
    commit: "a3f9c12e4b7d4c1d8e2f3a4b5c6d7e8f90a1b2c3",
    message: "Annual pricing on the plans page",
    branch: "main",
    current: true,
  },
};

const REQ = [
  ["GET /search?q=mug", 200, 71],
  ["GET /plans", 200, 29],
  ["GET /products/harbor-mug", 200, 31],
  ["GET /favicon.ico", 200, 2],
  ["POST /api/cart", 201, 52],
  ["GET /", 200, 38],
  ["GET /_next/static/chunks/app.js", 304, 3],
  ["POST /api/checkout", 500, 310],
  ["GET /api/cart", 200, 12],
] as const;
function logLines(): unknown[] {
  const out: unknown[] = [];
  let seq = 0;
  const t0 = SAMPLE_NOW - 20 * M;
  for (let i = 0; i < 44; i++) {
    const r = REQ[i % REQ.length] as (typeof REQ)[number];
    const at = t0 + i * 27_000;
    out.push({
      seq: ++seq,
      at,
      source: "requests",
      scope: "dpl_2",
      text: `${r[0]} ${r[1]} ${r[2]}ms`,
      level: r[1] >= 500 ? "error" : "info",
    });
    if (r[1] === 500) {
      out.push({
        seq: ++seq,
        at,
        source: "app",
        scope: "dpl_2",
        text: "Error: card_declined is not handled in /api/checkout",
        level: "error",
      });
      out.push({
        seq: ++seq,
        at,
        source: "app",
        scope: "dpl_2",
        text: "    at charge (/app/lib/pay.js:41:9)",
        level: "info",
      });
    } else if (i % 5 === 0)
      out.push({ seq: ++seq, at, source: "app", scope: "dpl_2", text: `cart ${4100 + i} saved`, level: "info" });
    if (i === 17)
      out.push({
        seq: ++seq,
        at,
        source: "jobs",
        scope: "jrx_1",
        text: "Nightly stock sync: 412 products checked, 6 changed",
        level: "info",
      });
  }
  return out;
}
const samples = Array.from({ length: 60 }, (_, i) => {
  const wave = Math.sin(i / 7) + Math.sin(i / 3) * 0.3;
  return {
    at: SAMPLE_NOW - (59 - i) * M,
    cpu: Math.round((4 + wave * 2.2) * 10) / 10,
    memMb: Math.round(200 + wave * 8),
    requests: Math.round(100 + wave * 30),
    errors: i % 23 === 0 ? 2 : 0,
    p50: Math.round(30 + wave * 6),
    p95: Math.round(46 + wave * 12),
  };
});
const run = (id: string, state: string, ago: number, secs: number, note?: string) => ({
  runId: id,
  jobId: "job_1",
  state,
  at: SAMPLE_NOW - ago * M,
  startedAt: SAMPLE_NOW - ago * M,
  endedAt: SAMPLE_NOW - ago * M + secs * 1000,
  by: "schedule",
  ...(state === "succeeded" ? { exitCode: 0 } : {}),
  ...(note ? { note } : {}),
});

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""));
  }, []);
  const view = q?.get("view") ?? "overview";
  const data = useMemo(() => {
    if (q === null) return null;
    const s = createSampleApps({ deferred: [], sites: [site] as never });
    const call = s.data.call;
    const answers: Record<string, (i: Record<string, unknown>) => unknown> = {
      "sites.list": () => ({ sites: [site] }),
      "sites.get": () => ({ site }),
      "sites.status": () => ({ answering: true, live: true, blocked: false, url: site.url }),
      "sites.host": () => ({
        origin: "https://northwind.vyre.run",
        relay: false,
        computers: false,
        domains: true,
        deploy: true,
        sitesDomain: "northwind.vyre.run",
      }),
      "sites.domains_get": () => ({ domains: [] }),
      "sites.deployments": () => ({ deployments: [site.lastDeploy], total: 1 }),
      "sites.previews": () => ({ previews: [] }),
      "sites.env_list": () => ({ entries: [], wanted: [] }),
      "sites.logs": () => ({ lines: ["Ready in 412ms"], state: "ready" }),
      "sites.logs_read": (i) =>
        i["source"] === "jobs" && i["scope"]
          ? {
              lines: [
                {
                  seq: 1,
                  at: SAMPLE_NOW - 9 * 60 * M,
                  source: "jobs",
                  scope: "jrx_1",
                  text: "Nightly stock sync: 412 products checked, 6 changed",
                  level: "info",
                },
              ],
              lastSeq: 1,
              scopes: [],
            }
          : i["after"]
            ? { lines: [], lastSeq: 9999, scopes: [] }
            : {
                lines: logLines(),
                lastSeq: 9999,
                scopes: [
                  { scope: "dpl_2", source: "app", title: "Deploy a3f9c12", at: SAMPLE_NOW, lines: 90 },
                  { scope: "dpl_1", source: "app", title: "Deploy 1a2b3c4", at: SAMPLE_NOW - 26 * 60 * M, lines: 30 },
                ],
              },
      "sites.metrics": () => ({
        window: "1h",
        samples,
        now: {
          cpu: { value: 4, of: 100 },
          mem: { valueMb: 202, ofMb: 512 },
          requestsPerMin: 101,
          p95: 48,
          errorRate: 0.4,
        },
        measured: true,
        requests: true,
      }),
      "sites.jobs_list": () => ({
        jobs: [
          {
            jobId: "job_1",
            siteId: "sit_cx",
            name: "Nightly stock sync",
            schedule: "0 2 * * *",
            when: "Every day at 02:00",
            command: "node scripts/sync-stock.js",
            zone: "America/New_York",
            enabled: true,
            timeoutSec: 600,
            nextAt: SAMPLE_NOW + 5 * 60 * M,
            last: run("jrx_1", "succeeded", 9 * 60, 38),
          },
        ],
      }),
      "sites.job_runs": () => ({
        runs: [
          run("jrx_1", "succeeded", 9 * 60, 38),
          run("jrx_2", "succeeded", 33 * 60, 41),
          run("jrx_3", "failed", 57 * 60, 4, "It ended with an error (exit code 1)."),
          run("jrx_4", "skipped", 81 * 60, 0, "The last run was still going, so this one did not start."),
        ],
      }),
      "sites.services_list": () => ({
        services: [
          {
            serviceId: "wkr_1",
            siteId: "sit_cx",
            name: "Queue",
            kind: "worker",
            command: "node worker.js",
            state: "running",
          },
          {
            serviceId: "wkr_2",
            siteId: "sit_cx",
            name: "Mailer",
            kind: "worker",
            command: "node mailer.js",
            state: "backoff",
            note: "It stopped with an error (exit code 1). Starting again in 16 seconds.",
          },
        ],
      }),
      "sites.backups_list": () => ({
        hasDatabase: true,
        database: { bytes: 48 * 1024 * 1024 },
        backups: [
          {
            backupId: "bkp_1",
            siteId: "sit_cx",
            state: "ready",
            by: "schedule",
            at: SAMPLE_NOW - 3 * 60 * M,
            bytes: 12 * 1024 * 1024,
          },
          {
            backupId: "bkp_2",
            siteId: "sit_cx",
            state: "ready",
            by: "person",
            at: SAMPLE_NOW - 27 * 60 * M,
            bytes: 11 * 1024 * 1024,
            pinned: true,
          },
          {
            backupId: "bkp_3",
            siteId: "sit_cx",
            state: "failed",
            by: "schedule",
            at: SAMPLE_NOW - 51 * 60 * M,
            note: "The dump failed: the database did not answer.",
          },
        ],
      }),
      "vault.items.list": () => ({ items: [], counts: {} }),
    };
    s.data.call = async (cap, input) => {
      const a = answers[cap];
      return a ? a(input as Record<string, unknown>) : call(cap, input);
    };
    s.data.nameOf = (id) => (id === "usr_anem" ? "Anem Fatima" : id);
    s.data.me = { id: "usr_anem", name: "Anem Fatima" };
    (s.data as unknown as { peek?: unknown }).peek = undefined;
    return s.data;
  }, [q, view]);
  if (data === null) return <View style={{ flex: 1 }} />;
  const route: AppsRoute = { kind: "detail", group: "sites", id: "sit_cx" };
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <AppsLayout data={data} route={route} />
    </View>
  );
}
