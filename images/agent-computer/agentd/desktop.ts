// The desktop around the browser (owner ruling 20 Oct): the Vyre wallpaper and a dock of three launchers, Chrome, Terminal and Files, and nothing else. openbox manages the windows, feh draws the
// wallpaper, tint2 is the dock. Files opens the agent's own Vyre Files folder (the folder bound at ~/Vyre). Launchers are written at start because they name this computer's profile and folder.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Screen } from "./x11.ts";

export const DOCK_HEIGHT = 72;
/** The browser takes this share of the desktop in each direction, centred above the dock, so the wallpaper shows around it. */
export const BROWSER_SHARE = 0.7;
const ASSETS = "/opt/desktop";

export interface Desktop { stop(): void }

/** Where Chromium sits so the wallpaper and the dock stay in view. */
export function browserBounds(screen: Pick<Screen, "width" | "height">): { x: number; y: number; width: number; height: number } {
  const width = Math.round(screen.width * BROWSER_SHARE), height = Math.round((screen.height - DOCK_HEIGHT) * BROWSER_SHARE);
  return { x: Math.round((screen.width - width) / 2), y: Math.round((screen.height - DOCK_HEIGHT - height) / 2), width, height };
}

function launcher(name: string, exec: string, icon: string): string {
  return `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\nIcon=${ASSETS}/${icon}.svg\nTerminal=false\n`;
}

export function startDesktop(screen: Screen, home: string, profileDir: string, log: (m: string) => void): Desktop {
  const dir = `${home}/.config/vyre-desktop`;
  mkdirSync(dir, { recursive: true });
  mkdirSync(`${home}/Vyre`, { recursive: true });
  const b = browserBounds(screen);
  // Chrome: the same profile and instance the agent drives, so a second window is a window of the same browser.
  writeFileSync(`${dir}/chrome.desktop`, launcher("Chrome", `chromium --disable-dev-shm-usage --disable-gpu --user-data-dir=${profileDir} --window-position=${b.x},${b.y} --window-size=${b.width},${b.height}`, "chrome"));
  writeFileSync(`${dir}/terminal.desktop`, launcher("Terminal", `xterm -fa Monospace -fs 11 -bg #1f2430 -fg #e8ecf8 -e /bin/bash`, "terminal"));
  writeFileSync(`${dir}/files.desktop`, launcher("Files", `pcmanfm --no-desktop ${home}/Vyre`, "files"));
  writeFileSync(`${dir}/tint2rc`, [
    "rounded = 18", "border_width = 0", "background_color = #2a2c52 100", "border_color = #000000 0",
    "panel_items = L", "panel_position = bottom center horizontal", `panel_size = 236 ${DOCK_HEIGHT}`, "panel_margin = 0 12", "panel_padding = 12 8 12", "panel_background_id = 1",
    "panel_layer = top", "strut_policy = none", "wm_menu = 0", "autohide = 0", "disable_transparency = 1",
    "launcher_padding = 10 6 18", "launcher_background_id = 0", "launcher_icon_size = 52", "launcher_icon_theme = hicolor", "launcher_tooltip = 1",
    `launcher_item_app = ${dir}/chrome.desktop`, `launcher_item_app = ${dir}/terminal.desktop`, `launcher_item_app = ${dir}/files.desktop`,
  ].join("\n") + "\n");
  const env = { ...process.env, DISPLAY: screen.display, HOME: home };
  const procs: ChildProcess[] = [];
  const run = (cmd: string, args: string[]): void => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    p.stderr!.on("data", (c: Buffer) => { const t = c.toString("utf8").trim(); if (t) log(`${cmd}: ${t.slice(0, 200)}`); });
    p.on("error", (e) => log(`${cmd} did not start: ${e.message}`));
    procs.push(p);
  };
  run("openbox", ["--config-file", `${ASSETS}/rc.xml`]);
  run("feh", ["--no-fehbg", "--bg-fill", `${ASSETS}/wallpaper.png`]);
  run("tint2", ["-c", `${dir}/tint2rc`]);
  return { stop() { for (const p of procs) p.kill("SIGTERM"); } };
}
