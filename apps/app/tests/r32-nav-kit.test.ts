// Shared helper for the r32-nav walks (a helper, not a walk): boots a fresh Space, claims it as the owner and returns a signed-in page. The viewport and scheme are the walk's choice.
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

export type Pg = import("playwright-core").Page;

export interface NavKit {
  page: Pg;
  context: import("playwright-core").BrowserContext;
  /** a second, signed-out browser context of the same size and scheme (a second person) */
  second(): Promise<import("playwright-core").Page>;
  origin: string;
  space: Awaited<ReturnType<typeof bootFreshSpace>>;
  api(cap: string, data: unknown): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  say(m: string): void;
  shot(name: string): Promise<void>;
  close(): Promise<void>;
}

export async function bootNav(o: {
  width: number;
  height: number;
  scheme: "dark" | "light";
  phone?: boolean;
  /** the shared folder name for pictures, under VYRE_NAV_SHOTS */
  tag: string;
}): Promise<NavKit | null> {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) return null;
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_NAV_SHOTS"] ?? "/tmp/vyre-nav-shots";
  fs.mkdirSync(shots, { recursive: true });
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: o.width, height: o.height },
    colorScheme: o.scheme,
    ...(o.phone ? { hasTouch: true } : {}),
  });
  const page = await context.newPage();
  await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
  await page.getByTestId("claim-name").fill("Nav Owner");
  await page.getByTestId("claim-username").fill("navowner");
  await page.getByTestId("claim-password").fill("fixture password 123");
  await page.getByTestId("claim-confirm").fill("fixture password 123");
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-create").click();
  await dismissOnboarding(page, { wait: 60_000 });
  await page.getByTestId(o.phone ? "mobile-shell" : "shell").waitFor({ timeout: 30_000 });
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
  );
  let n = 0;
  const api = async (cap: string, data: unknown): Promise<any> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { idempotencyKey: `nav-${cap}-${++n}`, ...(data as object) },
    });
    if (r.status() !== 200) throw new Error(`${cap}: ${r.status()} ${await r.text()}`);
    return (await r.json()).data;
  };
  const dir = path.join(shots, o.tag);
  fs.mkdirSync(dir, { recursive: true });
  return {
    page,
    context,
    second: async () => {
      const c2 = await browser.newContext({
        viewport: { width: o.width, height: o.height },
        colorScheme: o.scheme,
        ...(o.phone ? { hasTouch: true } : {}),
      });
      return c2.newPage();
    },
    origin: web.origin,
    space,
    api,
    say: (m) => console.log(`[nav ${new Date().toISOString().slice(14, 23)}] ${m}`),
    shot: async (name) => {
      await page.screenshot({ path: path.join(dir, `${name}.png`) });
    },
    close: async () => {
      await browser.close();
      await web.close();
      await space.stop();
    },
  };
}
