// Inline head script: marks app.start, applies the skin's CSS variables before first paint (same token data native uses),
// and registers the service worker after load so it never competes with startup.
// Rendered through expo-router/head: a custom +html file stops Expo from adding the bundle script tags (seen on SDK 58), so none is used.
import { skins } from "@vyre/ui/tokens";

export function bootScript(): string {
  const data: Record<string, { base: string; light: Record<string, string>; dark: Record<string, string> }> = {};
  for (const s of skins) data[s.id] = { base: s.base, light: s.light, dark: s.dark };
  const theme = `(function(){try{performance.mark("app.start");var T=${JSON.stringify(data)};var q=new URLSearchParams(location.search);var id=q.get("skin")||"paper";var k=T[id]||T.paper;var m=q.get("mode")||k.base;var v=k[m];var r=document.documentElement,s=r.style;for(var n in v)s.setProperty(n,v[n]);s.backgroundColor=v["--win"];s.colorScheme=m;r.setAttribute("data-skin",id);r.setAttribute("data-mode",m);window.__VYRE_THEME_AT__=performance.now();}catch(e){}})();`;
  const sw = `addEventListener("load",function(){if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});});`;
  return theme + sw;
}
