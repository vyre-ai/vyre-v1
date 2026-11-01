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

export interface Screens { browser: Browser; web: Edge; world: MailWorld; seats: Seat[]; /** what every browser shows and what the app was refused, saved when a journey fails */ debug(dir: string): Promise<void>; close(): Promise<void> }

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

/** Null (with the reason) when this machine cannot run the journeys: no web export, no Chromium. */
export async function browserOrSkip(): Promise<{ dist: string; chromium: import("playwright-core").BrowserType; exe: string } | string> {
  const required = process.env["VYRE_REQUIRE_CHROME"] === "1";
  const refuse = (why: string): string => { if (required) throw new Error(`${why} (VYRE_REQUIRE_CHROME=1: release evidence may not skip)`); return why; };
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) return refuse("VYRE_APP_DIST is not set: the release-evidence job builds the web export and points it there");
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) return refuse(`no Chromium at ${exe}`);
  return { dist, chromium, exe };
}

/** A mail world whose address is the edge the browser opens, so the redirect a sign-in comes back to lands on the app. */
export async function bootScreens(o: Omit<WorldOptions, "address">, env: { dist: string; chromium: import("playwright-core").BrowserType; exe: string }): Promise<Screens> {
  const port = await freePort();
  const world = await bootMailWorld({ ...o, address: `http://127.0.0.1:${port}` });
  const web = await edge(env.dist, world.d.url, undefined, port);
  const browser = await env.chromium.launch({ executablePath: env.exe, args: ["--no-sandbox"] });
  const seats: Seat[] = [];
  const debug = async (dir: string): Promise<void> => {
    fs.mkdirSync(`${dir}/_failed`, { recursive: true });
    for (const [i, st] of seats.entries()) {
      await st.page.screenshot({ path: `${dir}/_failed/seat${i}-${st.who.username}.png` }).catch(() => undefined);
      fs.writeFileSync(`${dir}/_failed/seat${i}-${st.who.username}.log`, `${st.page.url()}\nerrors: ${JSON.stringify(st.errors)}\n${st.logs.join("\n")}\n`);
    }
  };
  return { browser, web, world, seats, debug, async close() { await browser.close(); web.close(); await world.stop(); } };
}

/** What the browser holds once signed in as this person. */
async function sessionFor(s: Screens, who: Person, role: string): Promise<string> {
  const marker = ((await createCapCaller({ baseUrl: s.world.d.url, token: () => who.token })("spaces.get", {})) as { space: { fingerprint: string } }).space.fingerprint;
  const def = { spaceId: "spc_pmail", name: s.world.kind === "personal" ? "Personal" : "Fresh Co", kind: s.world.kind, address: s.web.origin, role, tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: role === "Owner", terminal: role === "Owner", counts: {}, dots: {} };
  return JSON.stringify({ sessions: { [s.web.origin]: { baseUrl: s.web.origin, token: who.token, def, personId: who.id, marker } } });
}

export interface Seat { ctx: BrowserContext; page: Page; who: Person; errors: string[]; /** console errors and refused calls, for a failure to explain itself */ logs: string[]; setEmail(email: string): void }

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
  const logs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(`console ${m.text().slice(0, 300)}`); });
  page.on("response", (r) => { if (r.status() >= 400) logs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const made: Seat = { ctx, page, who, errors, logs, setEmail: (e) => { email = e; } };
  s.seats.push(made);
  return made;
}

export async function open(seatOf: Seat, s: Screens, route: string): Promise<void> {
  await seatOf.page.goto(`${s.web.origin}${route}`, { waitUntil: "load" });
  await seatOf.page.getByTestId("shell").or(seatOf.page.getByTestId("mobile-shell")).first().waitFor({ timeout: 30_000 });
  const onboarding = seatOf.page.getByTestId("onboarding");
  if (await onboarding.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
    // a person leaves onboarding with Finish later; when this Space's screen has no such button the picture says what is there instead
    const closed = await seatOf.page.getByTestId("onboarding-close").click({ timeout: 4_000 }).then(() => true, () => false);
    if (!closed) {
      fs.mkdirSync("shots-evidence/personal-mail/_debug", { recursive: true });
      await seatOf.page.screenshot({ path: `shots-evidence/personal-mail/_debug/onboarding-${Date.now()}.png` });
      await seatOf.page.keyboard.press("Escape");
    }
    await onboarding.waitFor({ state: "detached", timeout: 10_000 });
  }
}

let shotCount = 0;
/** One step, two pictures at desktop width: light and dark. Nothing here resizes the page, so what is open stays open. */
export async function shoot(p: Page, dir: string, step: string): Promise<string[]> {
  const out: string[] = [];
  const n = String(++shotCount).padStart(2, "0");
  fs.mkdirSync(dir, { recursive: true });
  for (const scheme of SCHEMES) {
    await p.emulateMedia({ colorScheme: scheme });
    await p.waitForTimeout(250);
    const file = path.join(dir, `${n}-${step}-${scheme}-desktop.png`);
    await p.screenshot({ path: file, animations: "disabled" });
    out.push(file);
  }
  await p.emulateMedia({ colorScheme: "light" });
  return out;
}

/**
 * The phone pass, at the end of a journey: the phone width draws another shell, so it is not done mid-flow. Each route is opened fresh at phone width and shot in light and dark.
 * A route that cannot draw at phone width fails the journey like any other step.
 */
export async function phonePass(seatOf: Seat, s: Screens, dir: string, steps: { name: string; route: string }[]): Promise<void> {
  await seatOf.page.setViewportSize(SIZES.phone);
  for (const st of steps) {
    await open(seatOf, s, st.route);
    await seatOf.page.waitForTimeout(800);
    await shoot(seatOf.page, dir, `phone-${st.name}`).then((files) => files.forEach((f) => fs.renameSync(f, f.replace("-desktop.png", "-phone.png"))));
  }
  await seatOf.page.setViewportSize(SIZES.desktop);
}
