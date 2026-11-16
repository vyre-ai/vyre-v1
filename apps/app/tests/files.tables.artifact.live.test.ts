// @tsx
// The wide-table rule on an artifact page (16 Nov 2026): a published page holding a table of 11 columns and 42 rows is given the whole width of its tab, edge to edge, on a dark desktop and a light phone, so the
// table the page draws (width 100%) uses all of it. The app's origin is a front server that also stands for the Space's artifact host (a.localhost:<port>), as in artifact-tab.live.test.ts. Pictures go to VYRE_VIEWER_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { claimOnEdge, dismissOnboarding, edge, startDaemon, stopper } from "./real-app-harness.test.ts";
import { WIDE_MD } from "./files.tables-kit.test.ts";

const head = (WIDE_MD.split("\n").find((l) => l.startsWith("| Column")) ?? "").split("|").slice(1, -1);
const rows = WIDE_MD.split("\n").filter((l) => l.startsWith("| Applicant"));
const HTML = `<!doctype html><title>Applicants</title><body style="margin:0;padding:16px;font:14px sans-serif;background:#fff;color:#111"><h1>Applicants</h1><p>A short paragraph above the table.</p><div id="w" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>${head.map((h) => `<th style="border:1px solid #ccc;padding:6px;text-align:left">${h.trim()}</th>`).join("")}</tr></thead><tbody>${rows
  .map(
    (r) =>
      `<tr>${r
        .split("|")
        .slice(1, -1)
        .map((c) => `<td style="border:1px solid #ccc;padding:6px">${c.trim()}</td>`)
        .join("")}</tr>`,
  )
  .join("")}</tbody></table></div>`;

test("an artifact page with a wide table gets the whole width of its tab, desktop and phone", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_VIEWER_SHOTS"] ?? "/tmp/vyre-viewer-shots";
  fs.mkdirSync(shots, { recursive: true });
  let daemonUrl = "";
  let inner = "";
  const front = http.createServer((req, res) => {
    const host = String(req.headers.host ?? "");
    const to = new URL(host.startsWith("a.localhost") ? daemonUrl : inner);
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
  });
  front.on("upgrade", (req, socket, head2) => {
    const to = new URL(inner);
    const up = net.connect(Number(to.port), to.hostname, () => {
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head2.length) up.write(head2);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(front.address() as net.AddressInfo).port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-artifact-table-"));
  const daemon = await startDaemon(dir, ["--space", "spc_fresh", "--space-name", "Fresh Co", "--address", origin]);
  daemonUrl = daemon.url;
  const web = await edge(dist, daemon.url);
  inner = web.origin;
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(claimOnEdge(daemon.claim!, origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Tab Owner");
    await page.getByTestId("claim-username").fill("tabowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    const made = await context.request.post(`${origin}/v1/sites/artifact_publish`, {
      headers: { authorization: `Bearer ${token}` },
      data: { idempotencyKey: "tbl-art", title: "Applicants", html: HTML },
    });
    assert.equal(made.status(), 200, await made.text());
    const id = ((await made.json()) as { data: { artifactId: string } }).data.artifactId;
    for (const [tag, size, scheme] of [
      ["desktop", { width: 1440, height: 900 }, "dark"],
      ["phone", { width: 390, height: 844 }, "light"],
    ] as const) {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${origin}/#subject=artifact:${id}`, { waitUntil: "load" });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("artifact-view").waitFor({ timeout: 30_000 });
      const frame = page.frameLocator("[data-testid='artifact-frame']");
      await frame.locator("#w table").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500);
      const tab = (await page.getByTestId("artifact-view").boundingBox())!;
      const fr = (await page.getByTestId("artifact-frame").boundingBox())!;
      const tb = (await frame.locator("#w").boundingBox())!;
      console.warn("ARTIFACT-FIT", tag, JSON.stringify({ tab: tab.width, frame: fr.width, table: tb.width }));
      assert.ok(
        fr.width >= tab.width - 1,
        `${tag}: the page frame takes the whole width of its tab (${fr.width} of ${tab.width})`,
      );
      assert.ok(
        tb.width >= fr.width - 40 && tb.width <= fr.width,
        `${tag}: the page's table box uses the frame (${tb.width} of ${fr.width})`,
      );
      await page.screenshot({ path: path.join(shots, `artifact-table-${tag}.png`) });
    }
  } finally {
    await browser.close();
    web.close();
    front.close();
    await stopper(daemon.child)();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
