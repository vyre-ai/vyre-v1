// What a visit will load next, told to the browser in the page itself (r39). The export splits the app into an entry and some hundred small chunks that a place pulls in when it opens (Expo's granular chunking:
// the entry holds the list of files each async import needs). Left alone, the browser finds out one wave at a time: the entry runs, asks for the shell and its shared chunks, runs those, asks for the place and
// its chunks, then for the route table. This reads those lists from the files themselves and puts them in the page: a visit that already has a session preloads the shell, the place it will open (the address,
// else the last one) and the route table at once, then prefetches the pages that place opens on request; a visitor with no session gets them prefetched after the page is up, so the first screen after signing in finds them in the cache.
// Nothing here is needed to run: a page whose entry has no such lists is sent as it is.
import fs from "node:fs";
import path from "node:path";

/** The chunk each place's loader (apps/app/src/shell/places.ts) imports, by place id: Metro names a chunk after its first module. */
export const PLACE_CHUNKS: Readonly<Record<string, string>> = {
  chat: "chats",
  mail: "inbox",
  records: "records",
  files: "files",
  sites: "apps",
  automations: "automations",
  vault: "vault",
  settings: "settings",
  console: "console",
};
const SHELL_CHUNKS = ["ShellHost", "routes", "screens"];
/** The pages of Chats that load when they are opened (apps/app/src/shell/providers/detail-lazy.tsx, places/chats/mounts/lazy-pages.tsx): fetched quietly once the first screen is up. */
const IDLE_CHUNKS = [
  "file-detail",
  "record-detail",
  "GoalPage",
  "ProjectScreen",
  "TaskDetail",
  "TasksPage",
  "AgentForm",
];
const URL_LIST = /"(\/_expo\/static\/js\/web\/[^"]+\.js)"(?:,"\/_expo\/static\/js\/web\/[^"]+\.js")*/g;
const URL_IN = /"(\/_expo\/static\/js\/web\/[^"]+\.js)"/g;
const nameOf = (url: string): string => (/\/([^/]+?)-[0-9a-f]{16,}\.js$/.exec(url) ?? [])[1] ?? "";

/** Every list of chunk files in a chunk's code, by the name of the first file in it (that chunk, then the shared chunks it needs). */
export function listsIn(js: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of js.matchAll(URL_LIST)) {
    const urls = [...m[0].matchAll(URL_IN)].map((x) => x[1]!);
    const name = nameOf(urls[0]!);
    if (name && !out.has(name)) out.set(name, urls);
  }
  return out;
}

export interface Hints {
  shell: string[];
  places: Record<string, string[]>;
  /** Files of the pages a place opens on request, not already in the lists above. */
  idle: string[];
}

const read = (dir: string, url: string): string => {
  try {
    return fs.readFileSync(path.join(dir, url), "utf8");
  } catch {
    return "";
  }
};

/** The lists the page's scripts hold for the shell and each place, followed one step into the chunks they name (the route table is asked for from the shell, not the entry). Null when there are none. */
export function hintsFor(dir: string, scripts: string[]): Hints | null {
  const found = new Map<string, string[]>();
  const take = (js: string): void => {
    for (const [k, v] of listsIn(js)) if (!found.has(k)) found.set(k, v);
  };
  for (const s of scripts) take(read(dir, s));
  const wanted = [...SHELL_CHUNKS, ...Object.values(PLACE_CHUNKS)];
  for (const name of wanted) {
    const own = found.get(name)?.[0];
    if (own) take(read(dir, own));
  }
  const shell = [...new Set(SHELL_CHUNKS.flatMap((n) => found.get(n) ?? []))];
  if (!found.has("ShellHost")) return null;
  const places: Record<string, string[]> = {};
  for (const [id, chunk] of Object.entries(PLACE_CHUNKS)) {
    const l = found.get(chunk);
    if (l) places[id] = l;
  }
  // the pages a place opens later are named in the place's own files: read those too
  for (const l of Object.values(places)) for (const f of l) take(read(dir, f));
  const have = new Set([...shell, ...Object.values(places).flat()]);
  const idle = [...new Set(IDLE_CHUNKS.flatMap((n) => found.get(n) ?? []))].filter((f) => !have.has(f));
  return { shell, places, idle };
}

const SCRIPT = `(function(){try{var H=JSON.parse(document.getElementById("vyre-hints").textContent),d=document,seen={},P=H.places;
function put(rel,l,hi){for(var i=0;i<l.length;i++){var u=l[i];if(seen[u])continue;seen[u]=1;var e=d.createElement("link");e.rel=rel;e.as="script";e.href=u;if(hi)e.setAttribute("fetchpriority","high");d.head.appendChild(e)}}
var seg=location.pathname.split("/")[1]||"",ui=null,S=null;
try{ui=JSON.parse(localStorage.getItem("vyre.ui.v1")||"null")}catch(e){}
try{S=JSON.parse(localStorage.getItem("vyre.session.v1")||"null")}catch(e){}
var pl=P[seg]?seg:(ui&&P[ui.lastPlace]?ui.lastPlace:"chat");
if(S&&S.sessions&&S.sessions[location.origin]){put("preload",H.shell,1);put("preload",P[pl]||[]);addEventListener("load",function(){(window.requestIdleCallback||setTimeout)(function(){put("prefetch",H.idle||[])})})}
else addEventListener("load",function(){(window.requestIdleCallback||setTimeout)(function(){put("prefetch",H.shell);put("prefetch",P[pl]||[])})});
}catch(e){}})();`;

/** The page with its hints, or the page as it is when it names no entry chunk or the entry has no lists. */
export function injectHints(html: string, dir: string): string {
  const scripts = [...html.matchAll(/<script[^>]+src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/g)].map((m) => m[1]!);
  if (scripts.length === 0) return html;
  const h = hintsFor(dir, scripts);
  if (!h) return html;
  const json = JSON.stringify(h).replace(/</g, "\\u003c");
  const tag = `<script id="vyre-hints" type="application/json">${json}</script><script>${SCRIPT}</script>`;
  // at the end of the head, after the links the export puts there for the entry: the entry is asked for before the hints are
  return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : html;
}
