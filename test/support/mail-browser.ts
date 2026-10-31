// The real app in a real Chromium in front of a mail world (test/support/mail-world.ts): the production web export served on the address the Space says people reach it at, a signed-in
// session per person, the provider's sign-in page answered by the fake providers, and screenshots at every step in light and dark, desktop and phone.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createCapCaller } from "../../client/src/gateway/index.ts";
import { edge } from "../../apps/app/tests/real-app-harness.test.ts";
import type { Edge } from "../../apps/app/tests/real-app-harness.test.ts";
import { bootMailWorld } from "./mail-world.ts";
import type { MailWorld, Person, WorldOptions } from "./mail-world.ts";

export const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } } as const;
export const SCHEMES = ["light", "dark"] as const;

type Browser = import("playwright-core").Browser;
type BrowserContext = import("playwright-core").BrowserContext;
type Page = import("playwright-core").Page;

export interface Screens { browser: Browser; web: Edge; world: MailWorld; close(): Promise<void> }

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

/** Null (with the reason) when this machine cannot run the journeys: no web export, no Chromium. */
export async function browserOrSkip(): Promise<{ dist: string; chromium: import("playwright-core").BrowserType; exe: string } | string> {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) return "VYRE_APP_DIST is not set: build the web export (apps/app: npx expo export --platform web --output-dir dist) and point it there";
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) return `no Chromium at ${exe}`;
  return { dist, chromium, exe };
}

/** A mail world whose address is the edge the browser opens, so the redirect a sign-in comes back to lands on the app. */
export async function bootScreens(o: Omit<WorldOptions, "address">, env: { dist: string; chromium: import("playwright-core").BrowserType; exe: string }): Promise<Screens> {
  const port = await freePort();
  const world = await bootMailWorld({ ...o, address: `http://127.0.0.1:${port}` });
  const web = await edge(env.dist, world.d.url, undefined, port);
  const browser = await env.chromium.launch({ executablePath: env.exe, args: ["--no-sandbox"] });
  return { browser, web, world, async close() { await browser.close(); web.close(); await world.stop(); } };
}

/** What the browser holds once signed in as this person. */
async function sessionFor(s: Screens, who: Person, role: string): Promise<string> {
  const marker = ((await createCapCaller({ baseUrl: s.world.d.url, token: () => who.token })("spaces.get", {})) as { space: { fingerprint: string } }).space.fingerprint;
  const def = { spaceId: "spc_pmail", name: s.world.kind === "personal" ? "Personal" : "Fresh Co", kind: s.world.kind, address: s.web.origin, role, tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: role === "Owner", terminal: role === "Owner", counts: {}, dots: {} };
  return JSON.stringify({ sessions: { [s.web.origin]: { baseUrl: s.web.origin, token: who.token, def, personId: who.id, marker } } });
}

export interface Seat { ctx: BrowserContext; page: Page; who: Person; errors: string[]; setEmail(email: string): void }

/**
 * A browser for one person. Opening a provider's sign-in page is answered the way the provider does after the person approves: a redirect back to the app with a code for the
 * account `setEmail` named last. The app's own popup then finishes the sign-in as that person.
 */
export async function seat(s: Screens, who: Person, role: string): Promise<Seat> {
  const saved = await sessionFor(s, who, role);
  const ctx = await s.browser.newContext({ viewport: SIZES.desktop });
  await ctx.addInitScript((v: string) => { try { if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", v); } catch { /* blocked storage */ } }, saved);
  let email = "";
  await ctx.route(/^https:\/\/(accounts\.google\.com|login\.microsoftonline\.com)\//, async (route) => {
    const u = new URL(route.request().url());
    const back = new URL(u.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("state", u.searchParams.get("state") ?? "");
    back.searchParams.set("code", s.world.fake.codeFor(email));
    await route.fulfill({ status: 302, headers: { location: back.toString() }, body: "" });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  return { ctx, page, who, errors, setEmail: (e) => { email = e; } };
}

export async function open(seatOf: Seat, s: Screens, route: string): Promise<void> {
  await seatOf.page.goto(`${s.web.origin}${route}`, { waitUntil: "load" });
  await seatOf.page.getByTestId("shell").or(seatOf.page.getByTestId("mobile-shell")).first().waitFor({ timeout: 30_000 });
  const onboarding = seatOf.page.getByTestId("onboarding");
  if (await onboarding.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
    await seatOf.page.getByTestId("onboarding-close").click({ timeout: 10_000 });
    await onboarding.waitFor({ state: "detached", timeout: 10_000 });
  }
}

let shotCount = 0;
/** One step, four pictures: light and dark, desktop and phone. The page goes back to light desktop after. */
export async function shoot(p: Page, dir: string, step: string): Promise<string[]> {
  const out: string[] = [];
  const n = String(++shotCount).padStart(2, "0");
  fs.mkdirSync(dir, { recursive: true });
  for (const scheme of SCHEMES) {
    for (const [size, vp] of Object.entries(SIZES)) {
      await p.emulateMedia({ colorScheme: scheme });
      await p.setViewportSize(vp);
      await p.waitForTimeout(350);
      const file = path.join(dir, `${n}-${step}-${scheme}-${size}.png`);
      await p.screenshot({ path: file, animations: "disabled" });
      out.push(file);
    }
  }
  await p.emulateMedia({ colorScheme: "light" });
  await p.setViewportSize(SIZES.desktop);
  return out;
}
