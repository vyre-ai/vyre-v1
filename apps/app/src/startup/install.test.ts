// Android installs the web app (owner decision D18, 3 Nov 2026): the manifest carries everything Chrome needs to install it (an id, standalone, any and maskable icons at 192 and 512
// that exist at those sizes), the boot keeps Chrome's install offer from the first frame, and the offer is shown only while the app is not installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INSTALL_BOOT, INSTALL_EVENT, canInstall, promptInstall, runningInstalled } from "./install.ts";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const pngSize = (file: string): [number, number] => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("the manifest Chrome on Android installs from: an id, standalone, and separate any and maskable icons at 192 and 512 that are those sizes", () => {
  const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, "manifest.json"), "utf8")) as { id?: string; display?: string; start_url?: string; prefer_related_applications?: boolean; icons: { src: string; sizes: string; purpose?: string; type: string }[] };
  assert.equal(m.id, "/");
  assert.equal(m.display, "standalone");
  assert.equal(m.prefer_related_applications, false, "no store app is preferred over the web app");
  for (const purpose of ["any", "maskable"]) for (const size of [192, 512]) {
    const icon = m.icons.find((i) => i.purpose === purpose && i.sizes === `${size}x${size}`);
    assert.ok(icon, `${purpose} ${size}`);
    assert.equal(icon.type, "image/png");
    assert.deepEqual(pngSize(path.join(PUBLIC, icon.src.replace(/^\//, ""))), [size, size], `${icon.src} is ${size}px`);
  }
  assert.ok(!m.icons.some((i) => i.purpose === "any maskable"), "one icon per purpose, as Chrome asks");
});

test("the boot keeps Chrome's install offer and stops its own bar; installing drops it", () => {
  const on = new Map<string, (e?: unknown) => void>();
  const fired: string[] = [];
  const win: Record<string, unknown> = {};
  const g = { addEventListener: (t: string, f: (e?: unknown) => void) => on.set(t, f), dispatchEvent: (e: { type: string }) => fired.push(e.type), Event: class { type: string; constructor(t: string) { this.type = t; } }, window: win };
  new Function(...Object.keys(g), INSTALL_BOOT)(...Object.values(g));
  let prevented = false;
  const offer = { preventDefault: () => { prevented = true; }, prompt: () => undefined };
  on.get("beforeinstallprompt")!(offer);
  assert.equal(prevented, true);
  assert.equal(win["__VYRE_INSTALL__"], offer);
  on.get("appinstalled")!();
  assert.equal(win["__VYRE_INSTALL__"], null);
  assert.deepEqual(fired, [INSTALL_EVENT, INSTALL_EVENT]);
});

test("the offer shows only when Chrome made one and the app is not already installed; pressing it opens Chrome's dialog once", async () => {
  let prompted = 0;
  const offer = { prompt: () => { prompted++; }, userChoice: Promise.resolve({ outcome: "accepted" as const }) };
  const w = { __VYRE_INSTALL__: offer, matchMedia: () => ({ matches: false }), navigator: {} };
  assert.equal(canInstall(w), true);
  assert.equal(canInstall({ ...w, matchMedia: () => ({ matches: true }) }), false, "already the installed app");
  assert.equal(runningInstalled({ navigator: { standalone: true } }), true, "iPhone home screen");
  assert.equal(canInstall({ ...w, __VYRE_INSTALL__: null }), false, "no offer: an iPhone, or Chrome has not offered yet");
  assert.equal(await promptInstall(w), true);
  assert.equal(prompted, 1);
  assert.equal(canInstall(w), false, "the offer is spent");
  assert.equal(await promptInstall(w), false);
});
