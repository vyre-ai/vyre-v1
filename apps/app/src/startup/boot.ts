// Inline head script: marks app.start, applies the skin's CSS variables before first paint (same token data native uses),
// and registers the service worker once the app is usable so it never competes with startup.
import { skins } from "@vyre/ui/tokens";
import { APPEARANCE_KEY, tokenTable } from "../../../../ui/src/theme/theme.ts";

export function bootScript(): string {
  const data: Record<string, { base: string; light: Record<string, string>; dark: Record<string, string> }> = {};
  for (const s of skins) data[s.id] = { base: s.base, light: s.light, dark: s.dark };
  // System has no base of its own: it follows the device
  const sys = tokenTable()["system"];
  if (sys) data["system"] = { base: "", light: { ...sys.light }, dark: { ...sys.dark } };
  // The stored choice (vyre.appearance.v1, the same one the live controller writes) is read first, so a quit and reopen paints the chosen skin and mode on the first frame; the query string still
  // overrides it for previews and shots. System follows prefers-color-scheme. Without any choice the skin is System, as the controller's default.
  const theme = `(function(){try{performance.mark("app.start");var T=${JSON.stringify(data)};var q=new URLSearchParams(location.search);var dark=false;try{dark=matchMedia("(prefers-color-scheme: dark)").matches===true;}catch(e){}`
    + `var d=null;try{d=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"null");}catch(e){d=null;}`
    + `var sid=d&&typeof d.spaceId==="string"?d.spaceId:"";var row=d&&d.spaces&&Object.prototype.hasOwnProperty.call(d.spaces,sid)?d.spaces[sid]:null;var sk=d&&d.spaceSkin&&Object.prototype.hasOwnProperty.call(d.spaceSkin,sid)?d.spaceSkin[sid]:null;`
    + `var id=q.get("skin")||(row&&row.skin)||sk||"system";if(!Object.prototype.hasOwnProperty.call(T,id))id=T.system?"system":"paper";var k=T[id];`
    + `var m=q.get("mode")||(row&&(row.mode==="light"||row.mode==="dark")?row.mode:null)||k.base||(dark?"dark":"light");if(m!=="light"&&m!=="dark")m=dark?"dark":"light";`
    + `var v=k[m];var r=document.documentElement,s=r.style;for(var n in v)s.setProperty(n,v[n]);s.backgroundColor=v["--win"];s.colorScheme=m;r.setAttribute("data-skin",id);r.setAttribute("data-mode",m);r.setAttribute("data-theme",m);window.__VYRE_THEME_AT__=performance.now();}catch(e){}})();`;
  // The load event comes before the app is usable (the deferred scripts have run, React is still hydrating), and the worker's install fetches every place and caches the scripts,
  // which compiled them again alongside startup. So the worker waits for load and for app.usable (the "vyre:usable" event mark() sends), or 5 s after load at the latest.
  const sw = `(function(){var l=0,u=0,d=0;function go(){if(d||!("serviceWorker" in navigator))return;d=1;navigator.serviceWorker.register("/sw.js").catch(function(){});}`
    + `addEventListener("vyre:usable",function(){u=1;if(l)setTimeout(go,0);});addEventListener("load",function(){l=1;if(u)setTimeout(go,0);else setTimeout(go,5000);});})();`;
  return theme + sw;
}
