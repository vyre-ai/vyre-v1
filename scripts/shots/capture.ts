// Playwright shot of a screen by id, skin and density (ARCH 10.1, ARCH 10.6).
// The PNG is posted to the tracker as POST /api/packets/:id/proofs with { kind, ref, result }.
//   node scripts/shots/capture.ts --packet P-PR_62 --screen batch1 --both [--tracker url]

import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderScreenPage } from "./pages.ts";
import { defaultDensity, DESKTOP_WIDTH, heightFor, PHONE_WIDTH, placeSkin, type Density } from "./skins.ts";

export interface ShotPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface ShotBrowser {
  newPage(): Promise<ShotPage>;
  close(): Promise<void>;
}

export interface ProofBody {
  kind: "screenshot";
  ref: string;
  result: string;
}

export interface ProofFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number }>;
}

export interface ShotResultMeta {
  screenId: string;
  skin: string;
  skinId: string;
  space: string;
  density: Density;
  width: number;
  height: number;
  runtime: "react-native-web";
  contentType: "image/png";
  pngBase64: string;
  html: string;
}

export interface Captured {
  html: string;
  png: Uint8Array;
  body: ProofBody;
  url: string;
  status: number;
}

export function proofUrl(tracker: string, packetId: string): string {
  const base = tracker.replace(/\/$/, "");
  return `${base}/api/packets/${encodeURIComponent(packetId)}/proofs`;
}

function slug(name: string): string {
  return name.trim().toLowerCase().replaceAll(" ", "-");
}

export async function postProof(tracker: string, packetId: string, body: ProofBody, fetchImpl: ProofFetch): Promise<{ url: string; status: number }> {
  const url = proofUrl(tracker, packetId);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = process.env.VYRE_TRACKER_TOKEN;
  const actor = process.env.VYRE_TRACKER_ACTOR;
  if (token) headers["X-Tracker-Token"] = token;
  if (actor) headers["X-Actor"] = actor;
  const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`proof post failed: ${res.status} ${url}`);
  return { url, status: res.status };
}

export interface CaptureOpts {
  packetId: string;
  screenId: string;
  skin: string;
  width: number;
  height?: number;
  density?: Density;
  tracker: string;
  browser: ShotBrowser;
  fetchImpl?: ProofFetch;
}

/** Render one screen, screenshot the viewport, and post the PNG proof. */
export async function captureShot(opts: CaptureOpts): Promise<Captured> {
  const height = opts.height ?? heightFor(opts.width);
  const density = opts.density ?? defaultDensity(opts.width);
  const html = await renderScreenPage({
    screenId: opts.screenId,
    skin: opts.skin,
    width: opts.width,
    height,
    density,
  });
  const page = await opts.browser.newPage();
  try {
    await page.setViewportSize({ width: opts.width, height });
    await page.setContent(html);
    const png = new Uint8Array(await page.screenshot());
    const place = placeSkin(opts.skin);
    const meta: ShotResultMeta = {
      screenId: opts.screenId,
      skin: opts.skin,
      skinId: place.skinId,
      space: place.space,
      density,
      width: opts.width,
      height,
      runtime: "react-native-web",
      contentType: "image/png",
      pngBase64: Buffer.from(png).toString("base64"),
      html,
    };
    const body: ProofBody = {
      kind: "screenshot",
      ref: `${opts.screenId}-${slug(opts.skin)}-${opts.width}.png`,
      result: JSON.stringify(meta),
    };
    const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    const posted = await postProof(opts.tracker, opts.packetId, body, fetchImpl);
    return { html, png, body, url: posted.url, status: posted.status };
  } finally {
    await page.close();
  }
}

interface PwPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string, opts?: { waitUntil?: "domcontentloaded" }): Promise<void>;
  screenshot(opts?: { type?: "png" }): Promise<Uint8Array>;
  close(): Promise<void>;
}

interface PwBrowser {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}

/** Chromium from the prewarmed Playwright install (PW_FROM or ~/shots), same lookup as the 0.6 walk. */
export async function launchPlaywright(): Promise<ShotBrowser> {
  const { createRequire } = await import("node:module");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const from = process.env.PW_FROM || nodePath.join(os.homedir(), "shots");
  const req = createRequire(nodePath.join(from, "package.json"));
  const pw = req("playwright") as { chromium: { launch(opts?: { args?: string[] }): Promise<PwBrowser> } };
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-gpu"] });
  return {
    async newPage() {
      const page = await browser.newPage();
      return {
        setViewportSize: (size) => page.setViewportSize(size),
        setContent: (html) => page.setContent(html, { waitUntil: "domcontentloaded" }),
        screenshot: async () => new Uint8Array(await page.screenshot({ type: "png" })),
        close: () => page.close(),
      };
    },
    close: () => browser.close(),
  };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const packetId = flag(args, "--packet");
  const screenId = flag(args, "--screen") ?? "batch1";
  const tracker = flag(args, "--tracker") ?? process.env.VYRE_TRACKER_URL ?? "http://127.0.0.1:7790";
  if (!packetId) {
    console.error("usage: node scripts/shots/capture.ts --packet <id> [--screen batch1|screens] [--skin <Northwind|Harbor Studio>] [--width 390|1280] [--density compact|regular] [--both] [--tracker url]");
    process.exit(2);
  }
  const browser = await launchPlaywright();
  try {
    const jobs: { skin: string; width: number; density?: Density }[] = [];
    if (args.includes("--both")) {
      for (const skin of ["Northwind", "Harbor Studio"]) {
        for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) jobs.push({ skin, width });
      }
    } else {
      const skin = flag(args, "--skin") ?? "Northwind";
      const width = Number(flag(args, "--width") ?? String(PHONE_WIDTH));
      const densityFlag = flag(args, "--density");
      if (densityFlag !== undefined && densityFlag !== "compact" && densityFlag !== "regular") {
        throw new Error(`Unknown density: ${densityFlag}`);
      }
      jobs.push(densityFlag === "compact" || densityFlag === "regular" ? { skin, width, density: densityFlag } : { skin, width });
    }
    for (const job of jobs) {
      const shot = await captureShot({
        packetId,
        screenId,
        skin: job.skin,
        width: job.width,
        tracker,
        browser,
        ...(job.density ? { density: job.density } : {}),
      });
      console.log(`${shot.status} ${shot.body.ref}`);
    }
  } finally {
    await browser.close();
  }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  await main();
}
