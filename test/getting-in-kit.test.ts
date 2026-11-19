// Shared by the getting-in walks (rc.41): the desktop app as it ships (the production export served as packaged files at the app's own origin, with the shell's bridge and its window.open,
// which hands a link to the default browser), stand-ins for what Vyre's relay answers for a vyre.run name (held and awake, held and asleep, free, nothing there, or a Space server of its own
// reached through a real daemon), and pictures of every screen in the two shapes the lead looks at: dark desktop 1440 wide and light phone 390 wide.
import fs from "node:fs";
import path from "node:path";

type Page = import("playwright-core").Page;

/** The desktop app's own origin, as on Windows: what isPackagedOrigin (apps/app/src/shell/session/space-catalog.ts) knows as the packaged app, and never a Space's address itself. */
export const APP = "http://tauri.localhost";
export const SHOTS = process.env["VYRE_GETTING_IN_SHOTS"] ?? "shots-evidence/getting-in";
export const PASSWORD = "fixture getting in password123";

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** The production export as the packaged app's files. */
export async function servePackaged(page: Page, dist: string): Promise<void> {
  const base = path.resolve(dist);
  await page.route(`${APP}/**`, async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const candidates = [pathname, `${pathname}.html`, path.join(pathname, "index.html")].map((v) => path.join(base, v));
    const file =
      candidates.find((v) => v.startsWith(base) && fs.existsSync(v) && fs.statSync(v).isFile()) ??
      path.join(base, "index.html");
    await route.fulfill({
      status: 200,
      contentType: TYPES[path.extname(file)] ?? "application/octet-stream",
      body: fs.readFileSync(file),
    });
  });
}

/**
 * What the desktop shell gives the page: the bridge (a ready shell with no link waiting; commands this walk does not need answer null) and its window.open, which in the app hands the
 * address to the default browser (apps/desktop/src-tauri/src/lib.rs). Here every address handed over is kept, so the walk can read exactly what the browser was given.
 */
export const DESKTOP_SHELL = `(() => {
  const info = { app: "Vyre", version: "1.0.0-rc.41", platform: "macos", arch: "aarch64", sidecar: { phase: "ready", url: null, version: "1.0.0-rc.41", restarts: 0, error: null } };
  globalThis.__TAURI__ = { core: { invoke: async (command) => (command === "desktop_info" ? info : null) }, event: { listen: async () => () => undefined } };
  window.open = (url) => {
    const kept = JSON.parse(sessionStorage.getItem("walk:opened") || "[]");
    kept.push(String(url));
    sessionStorage.setItem("walk:opened", JSON.stringify(kept));
    return null;
  };
})();`;

/** Every address the app handed to the default browser, in order. */
export const handedToBrowser = (page: Page): Promise<string[]> =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("walk:opened") || "[]") as string[]);

/** What answers at a vyre.run name. `direct` is a Space server of its own at that name (a real daemon behind it). */
export type NameState = "held" | "asleep" | "free" | "down" | { direct: string };

/**
 * A vyre.run name, answered as the relay answers it (relay/worker/phone.js onHost): /__vyre/info.json readable from any page, and nothing else a page of another origin can read. `down`:
 * no answer at all. `direct`: the name is a Space server now, so every request reaches the real daemon, with the answers (and CORS headers) the daemon itself gives the desktop app.
 */
export async function vyreName(page: Page, name: string, label: string, state: () => NameState): Promise<void> {
  await page.route(`https://${name}.vyre.run/**`, async (route) => {
    const s = state();
    const url = new URL(route.request().url());
    if (typeof s === "object") {
      const res = await route.fetch({ url: s.direct + url.pathname + url.search });
      await route.fulfill({ response: res });
      return;
    }
    if (s === "down") {
      await route.abort("connectionrefused");
      return;
    }
    const cors = { "access-control-allow-origin": "*" };
    if (url.pathname === "/__vyre/info.json") {
      if (s === "free") {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          headers: cors,
          body: JSON.stringify({ name, held: false }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify({
          name,
          label,
          route: "r1",
          relay: "wss://relay.vyre.run",
          online: s === "held",
          seenAt: s === "asleep" ? Date.now() - 2 * 3_600_000 - 60_000 : Date.now(),
        }),
      });
      return;
    }
    // the shell page (or nothing, for a free name): never readable by a page of another origin
    await route.fulfill({
      status: s === "free" ? 404 : 200,
      contentType: "text/html",
      body: "<!doctype html><title>relay</title>",
    });
  });
}

/** An address of its own (not a vyre.run name): a real daemon behind it, or nothing answering. */
export async function ownAddress(page: Page, origin: string, state: () => "down" | { direct: string }): Promise<void> {
  await page.route(`${origin}/**`, async (route) => {
    const s = state();
    if (s === "down") {
      await route.abort("connectionrefused");
      return;
    }
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: s.direct + url.pathname + url.search }) });
  });
}

/** One screen in the two shapes the lead looks at: dark desktop (1440 wide) and light phone (390 wide). The page is left as it was. */
export async function shoot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  const was = page.viewportSize() ?? { width: 1440, height: 900 };
  const mode = await page.evaluate(() => document.documentElement.getAttribute("data-mode"));
  const set = (m: string): Promise<void> =>
    page.evaluate((v) => document.documentElement.setAttribute("data-mode", v), m);
  await page.setViewportSize({ width: 1440, height: 900 });
  await set("dark");
  await page.screenshot({ path: path.join(SHOTS, `${name}-desktop-dark.png`), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await set("light");
  await page.screenshot({ path: path.join(SHOTS, `${name}-phone-light.png`), animations: "disabled" });
  await page.setViewportSize(was);
  await page.evaluate((v) => {
    if (v) document.documentElement.setAttribute("data-mode", v);
    else document.documentElement.removeAttribute("data-mode");
  }, mode);
}

/** Claim a fresh Space as its owner, as a person does from the link the server prints, on the Space's own web address. Leaves the browser signed in there. */
export async function claimOwner(page: Page, claimUrl: string, name: string, username: string): Promise<void> {
  await page.goto(claimUrl);
  await page.getByTestId("claim-name").fill(name);
  await page.getByTestId("claim-username").fill(username);
  await page.getByTestId("claim-password").fill(PASSWORD);
  await page.getByTestId("claim-confirm").fill(PASSWORD);
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-create").click();
}

/** Sign out the way a person does: the Space tile's menu. */
export async function signOut(page: Page): Promise<void> {
  await page.getByTestId("space-tile").click();
  await page.getByRole("menuitem", { name: "Sign Out", exact: true }).click();
  await page.getByTestId("si-user").waitFor({ timeout: 20_000 });
}
