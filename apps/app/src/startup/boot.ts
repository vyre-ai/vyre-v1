// Inline head script: marks app.start, applies the skin's CSS variables before first paint (same token data native uses),
// and registers the service worker once the app is usable so it never competes with startup.
import { skins } from "@vyre/ui/tokens";

export function bootScript(): string {
  const data: Record<string, { base: string; light: Record<string, string>; dark: Record<string, string> }> = {};
  for (const s of skins) data[s.id] = { base: s.base, light: s.light, dark: s.dark };
  const theme = `(function(){try{performance.mark("app.start");var T=${JSON.stringify(data)};var q=new URLSearchParams(location.search);var id=q.get("skin")||"paper";var k=T[id]||T.paper;var m=q.get("mode")||k.base;var v=k[m];var r=document.documentElement,s=r.style;for(var n in v)s.setProperty(n,v[n]);s.backgroundColor=v["--win"];s.colorScheme=m;r.setAttribute("data-skin",id);r.setAttribute("data-mode",m);window.__VYRE_THEME_AT__=performance.now();}catch(e){}})();`;
  // The load event comes before the app is usable (the deferred scripts have run, React is still hydrating), and the worker's install fetches every place and caches the scripts,
  // which compiled them again alongside startup. So the worker waits for load and for app.usable (the "vyre:usable" event mark() sends), or 5 s after load at the latest.
  const sw = `(function(){var l=0,u=0,d=0;function go(){if(d||!("serviceWorker" in navigator))return;d=1;navigator.serviceWorker.register("/sw.js").catch(function(){});}`
    + `addEventListener("vyre:usable",function(){u=1;if(l)setTimeout(go,0);});addEventListener("load",function(){l=1;if(u)setTimeout(go,0);else setTimeout(go,5000);});})();`;
  return theme + sw;
}
