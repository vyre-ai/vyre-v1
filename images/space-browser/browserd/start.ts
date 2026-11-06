// The start page of a Space browser profile (owner, 6 Nov: "a really cool homepage with the Vyre logo on the background"): what every agent profile's first tab and new tab show. A calm page in Vyre's own
// colours, the Vyre V large and soft behind everything, the agent's name and face, one box that takes a search or an address, and a short row of the sites the agent opened lately.
// It is served from browserd on loopback (the browser's managed policy points the home page and the new tab at it) and it knows which profile asks by a cookie browserd sets in that profile's browser alone,
// so one agent's browser cannot read another's name or sites. Colours are the app's own tokens (ui/src/tokens/skins.ts): Paper for light, Graphite for dark. The V is the agent computer's wallpaper mark.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";

export interface Recent { host: string; url: string; title: string; at: number }
export interface StartData { name: string; face: string; /** The agent's face as an SVG string, drawn once by the host. Without it the page shows the initial. */ faceSvg?: string; recent: Recent[] }

const SKINS = {
  light: { win: "#FFFFFF", side: "#F7F7F6", raised: "#FFFFFF", sunk: "#F2F2F0", ink: "#18181A", ink2: "#4E4E52", ink3: "#8A8A8F", line: "#EFEFF1", accent: "#5B5BD6", glow: "rgba(91,91,214,0.10)", shadow: "0 1px 2px rgba(24,24,26,.06), 0 8px 28px rgba(24,24,26,.07)" },
  graphite: { win: "#161617", side: "#1C1C1E", raised: "#232325", sunk: "#121213", ink: "#EDEDEF", ink2: "#B9B9BE", ink3: "#85858B", line: "#2A2A2D", accent: "#8B8BFF", glow: "rgba(139,139,255,0.14)", shadow: "0 1px 2px rgba(0,0,0,.4), 0 10px 32px rgba(0,0,0,.35)" },
} as const;
export type StartSkin = keyof typeof SKINS;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const initial = (name: string): string => ([...name.trim()][0] ?? "V").toUpperCase();

/** The Vyre V, the mark of the agent computer's wallpaper (images/agent-computer/desktop/wallpaper.svg): one round-ended chevron. */
const V_PATH = "M0 0 L55 130 L110 0";

/** The face: the drawn SVG as an image (a data address, so nothing is fetched), else the initial. */
const faceInner = (d: StartData): string => (d.faceSvg && d.faceSvg.startsWith("<svg") ? `<img alt="" src="data:image/svg+xml;base64,${Buffer.from(d.faceSvg).toString("base64")}">` : esc(initial(d.name)));

/** The page. `skin` forces light or graphite; without it the page follows the browser's light or dark. */
export function startPageHtml(d: StartData, skin?: StartSkin): string {
  const vars = (s: (typeof SKINS)[StartSkin]): string => `--win:${s.win};--side:${s.side};--raised:${s.raised};--sunk:${s.sunk};--ink:${s.ink};--ink2:${s.ink2};--ink3:${s.ink3};--line:${s.line};--accent:${s.accent};--glow:${s.glow};--shadow:${s.shadow}`;
  const theme = skin
    ? `:root{${vars(SKINS[skin])};color-scheme:${skin === "light" ? "light" : "dark"}}`
    : `:root{${vars(SKINS.light)};color-scheme:light dark}@media (prefers-color-scheme:dark){:root{${vars(SKINS.graphite)}}}`;
  const tiles = d.recent.slice(0, 6).map((r) => `<a class="tile" href="${esc(r.url)}" title="${esc(r.title || r.host)}"><span class="dot">${esc(initial(r.host.replace(/^www\./, "")))}</span><span class="host">${esc(r.host.replace(/^www\./, ""))}</span></a>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.name)}</title>
<style>
${theme}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:var(--win);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","Helvetica Neue","Liberation Sans",Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
.glow{position:fixed;inset:0;background:radial-gradient(60% 55% at 50% 42%,var(--glow),transparent 70%)}
.mark{position:fixed;left:50%;top:50%;width:min(112vh,980px);height:auto;transform:translate(-50%,-47%);color:var(--ink);opacity:.055;pointer-events:none}
main{position:relative;min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px 96px}
.face{width:68px;height:68px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:var(--raised);color:var(--accent);font-size:28px;font-weight:600;box-shadow:var(--shadow);border:1px solid var(--line)}
.face img{width:100%;height:100%;display:block}
h1{margin-top:18px;font-size:30px;font-weight:600;letter-spacing:-.015em}
.sub{margin-top:4px;color:var(--ink3);font-size:14px;letter-spacing:.01em}
form{margin-top:34px;width:min(560px,100%)}
.box{display:flex;align-items:center;gap:12px;height:54px;padding:0 20px;border-radius:12px;background:var(--raised);border:1px solid var(--line);box-shadow:var(--shadow);transition:border-color .15s,box-shadow .15s}
.box:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px var(--glow),var(--shadow)}
.box svg{flex:none;color:var(--ink3)}
input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--ink);font:inherit;font-size:16px}
input::placeholder{color:var(--ink3)}
.recent{margin-top:40px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:740px}
.tile{display:flex;flex-direction:column;align-items:center;gap:8px;width:104px;padding:12px 4px;border-radius:12px;color:var(--ink2);text-decoration:none;transition:background .15s}
.tile:hover{background:color-mix(in srgb,var(--raised) 70%,transparent)}
.dot{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--raised);border:1px solid var(--line);color:var(--ink2);font-weight:600;font-size:18px;box-shadow:var(--shadow)}
.host{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--ink3)}
.none{margin-top:40px;color:var(--ink3);font-size:13.5px}
</style></head>
<body>
<div class="glow"></div>
<svg class="mark" viewBox="-80 -60 270 250" fill="none" stroke="currentColor" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${V_PATH}"/></svg>
<main>
<div class="face" aria-hidden="true">${faceInner(d)}</div>
<h1>${esc(d.name)}</h1>
<div class="sub">Browsing in your Space</div>
<form id="go" autocomplete="off"><label class="box"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="text" placeholder="Search or type an address" autofocus spellcheck="false"></label></form>
${tiles ? `<nav class="recent">${tiles}</nav>` : `<div class="none">Sites ${esc(d.name)} opens will show up here.</div>`}
</main>
<script>
document.getElementById("go").addEventListener("submit",function(e){e.preventDefault();var v=document.getElementById("q").value.trim();if(!v)return;
var url=/^[a-z][a-z0-9+.-]*:\\/\\//i.test(v)?v:(/^[^\\s]+\\.[a-z]{2,}(\\/[^\\s]*)?$/i.test(v)||/^localhost(:\\d+)?(\\/|$)/.test(v))?"https://"+v:"https://duckduckgo.com/?q="+encodeURIComponent(v);location.href=url});
</script>
</body></html>
`;
}

// ---- recent sites ----------------------------------------------------------------------------------------------------------------------------------

/** The sites a profile opened lately, newest first, one per host, kept in the profile's own folder. */
export function createRecentSites(dir: string, now: () => number = Date.now) {
  const file = join(dir, "recent.json");
  const read = (): Recent[] => { try { const j = JSON.parse(readFileSync(file, "utf8")) as Recent[]; return Array.isArray(j) ? j.filter((r) => typeof r.host === "string" && typeof r.url === "string") : []; } catch { return []; } };
  return {
    list: (): Recent[] => (existsSync(file) ? read() : []).slice(0, 6),
    add(url: string, title: string): void {
      let u: URL;
      try { u = new URL(url); } catch { return; }
      if (!/^https?:$/.test(u.protocol) || u.hostname === "127.0.0.1" || u.hostname === "localhost") return;
      const rows = [{ host: u.hostname, url: `${u.origin}/`, title: title.slice(0, 120), at: now() }, ...read().filter((r) => r.host !== u.hostname)].slice(0, 12);
      writeFileSync(file, JSON.stringify(rows));
    },
  };
}

// ---- the server ------------------------------------------------------------------------------------------------------------------------------------

export interface StartServer {
  /** The cookie value that makes this profile's browser the one that gets this profile's page. A new one each time the browser starts. */
  token(profileId: string): string;
  url(): string;
  close(): void;
}

export interface StartDeps {
  port: number;
  /** The page's data for a profile. */
  data(profileId: string): StartData;
}

export async function startStartServer(d: StartDeps): Promise<StartServer> {
  const byToken = new Map<string, string>();
  const byProfile = new Map<string, string>();
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://start");
    const cookie = /(?:^|;\s*)vyre_start=([a-f0-9]{48})/.exec(String(req.headers["cookie"] ?? ""))?.[1];
    const profile = cookie ? byToken.get(cookie) : undefined;
    if (url.pathname !== "/start" && url.pathname !== "/start/") { res.writeHead(404, { "content-type": "text/plain" }).end("Not found.\n"); return; }
    const skinQ = url.searchParams.get("skin");
    const skin: StartSkin | undefined = skinQ === "light" || skinQ === "graphite" ? skinQ : undefined;
    // a browser that does not carry a profile's cookie sees the page with no name and no sites
    const data = profile ? d.data(profile) : { name: "Vyre", face: "", recent: [] };
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" });
    res.end(startPageHtml(data, skin));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(d.port, "127.0.0.1", () => resolve()); });
  const port = (server.address() as { port: number }).port;
  return {
    token(profileId) {
      const old = byProfile.get(profileId);
      if (old) byToken.delete(old);
      const t = randomBytes(24).toString("hex");
      byToken.set(t, profileId);
      byProfile.set(profileId, t);
      return t;
    },
    url: () => `http://127.0.0.1:${port}/start`,
    close() { server.close(); },
  };
}
