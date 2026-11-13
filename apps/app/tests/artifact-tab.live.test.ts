// @tsx
// An artifact's tab in the real app, against a real daemon, never a blank white rectangle (rc.26, 13 Nov 2026: the owner pressed Open and got the title bar over an empty white area).
// The app's origin is a front server that also stands for the Space's artifact host (a.localhost:<port>, the same port): it hands that host to the daemon, answers it the way the relay's wildcard did
// (a 404 with nothing in it), or drops the connection, so the three things a real Space can do are walked in one browser. Shots go to VYRE_ARTIFACT_TAB_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { claimOnEdge, dismissOnboarding, edge, startDaemon, stopper } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

type Mode = "up" | "relay404" | "dropped";

test("artifact tab: the artifact host answering shows the page; a host that answers 404 with nothing, or drops the connection, shows the failed state with Retry, and Retry finds it once it answers", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const shots = process.env["VYRE_ARTIFACT_TAB_SHOTS"] ?? "/tmp/vyre-artifact-tab-shots";
  fs.mkdirSync(shots, { recursive: true });
  const tag = process.env["VYRE_ARTIFACT_TAB_TAG"] ?? "after";
  // VYRE_ARTIFACT_TAB_TAG=before points the walk at the app export of the build before the fix, to take the picture of what it drew; the walk then checks nothing
  const before = tag === "before";

  let mode: Mode = "up";
  let daemonUrl = "";
  let inner = "";
  // the one front: the app and the Space's API (through the edge) on 127.0.0.1:<port>, the artifact host on a.localhost:<port>
  const front = http.createServer((req, res) => {
    const host = String(req.headers.host ?? "");
    const pass = (to: URL): void => {
      const up = http.request(
        { host: to.hostname, port: to.port, path: req.url, method: req.method, headers: req.headers },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(up);
    };
    if (host.startsWith("a.localhost")) {
      if (mode === "dropped") {
        req.socket.destroy();
        return;
      }
      if (mode === "relay404") {
        res.writeHead(404, { "access-control-allow-origin": "*", "content-length": "0" });
        res.end();
        return;
      }
      pass(new URL(daemonUrl));
      return;
    }
    pass(new URL(inner));
  });
  front.on("upgrade", (req, socket, head) => {
    const to = new URL(inner);
    const up = net.connect(Number(to.port), to.hostname, () => {
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  const port = (front.address() as net.AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-artifact-tab-"));
  const daemon = await startDaemon(dir, ["--space", "spc_fresh", "--space-name", "Fresh Co", "--address", origin]);
  daemonUrl = daemon.url;
  const web = await edge(dist, daemon.url);
  inner = web.origin;
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const guard = guardCrashes(page);
    await page.goto(claimOnEdge(daemon.claim!, origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Tab Owner");
    await page.getByTestId("claim-username").fill("tabowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    const made = await context.request.post(`${origin}/v1/sites/artifact_publish`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        idempotencyKey: "tab-1",
        title: "Crew page",
        html: '<!doctype html><title>Crew page</title><body style="font:20px sans-serif"><h1 id="hi">Crew numbers</h1>',
      },
    });
    assert.equal(made.status(), 200, await made.text());
    const id = ((await made.json()) as { data: { artifactId: string } }).data.artifactId;
    const openTab = async (): Promise<void> => {
      await page.goto(`${origin}/#subject=artifact:${id}`, { waitUntil: "load" });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("artifact-view").waitFor({ timeout: 30_000 });
    };

    // 1. the host does not answer anything the app can read: the old tab was an empty white area under the title bar
    mode = "relay404";
    await openTab();
    if (before) {
      await page.waitForTimeout(5_000);
      await page.screenshot({ path: path.join(shots, `${tag}-relay-404.png`) });
      return;
    }
    await page.getByTestId("artifact-error").waitFor({ timeout: 30_000 });
    assert.equal(await page.getByTestId("artifact-frame").count(), 0, "no frame to be blank");
    assert.match(
      await page.getByTestId("artifact-error").innerText(),
      /This page could not be loaded from the Space/,
      "the plain error",
    );
    await page.screenshot({ path: path.join(shots, `${tag}-relay-404.png`) });

    // 2. the connection is dropped (no record or no certificate in a real Space)
    mode = "dropped";
    await openTab();
    await page.getByTestId("artifact-error").waitFor({ timeout: 30_000 });
    assert.equal(await page.getByTestId("artifact-frame").count(), 0);
    await page.screenshot({ path: path.join(shots, `${tag}-dropped.png`) });

    // 3. it answers: Retry finds it, and the page is drawn inside the frame
    mode = "up";
    await page.getByTestId("state-retry").click();
    const frame = page.frameLocator("[data-testid='artifact-frame']");
    await frame.locator("#hi").waitFor({ timeout: 30_000 });
    assert.equal(await frame.locator("#hi").innerText(), "Crew numbers");
    assert.equal(await page.getByTestId("artifact-error").count(), 0);
    await page.screenshot({ path: path.join(shots, `${tag}-page.png`) });
    await guard.check("after the walk");
  } finally {
    await browser.close();
    web.close();
    front.close();
    await stopper(daemon.child)();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
