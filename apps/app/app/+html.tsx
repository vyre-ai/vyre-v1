// Static document for the web export. The inline script sets the skin's CSS variables before first paint (same data as native),
// and the service worker registers after load so it never competes with startup.
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { skins } from "@vyre/ui/tokens";

const data: Record<string, { base: string; light: Record<string, string>; dark: Record<string, string> }> = {};
for (const s of skins) data[s.id] = { base: s.base, light: s.light, dark: s.dark };

const BOOT = `(function(){try{performance.mark("app.start");var T=${JSON.stringify(data)};var q=new URLSearchParams(location.search);var id=q.get("skin")||"paper";var k=T[id]||T.paper;var m=q.get("mode")||k.base;var v=k[m];var r=document.documentElement,s=r.style;for(var n in v)s.setProperty(n,v[n]);s.backgroundColor=v["--win"];s.colorScheme=m;r.setAttribute("data-skin",id);r.setAttribute("data-mode",m);window.__VYRE_THEME_AT__=performance.now();}catch(e){}})();`;
const SW = `addEventListener("load",function(){if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});});`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <ScrollViewStyleReset />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: SW }} />
      </body>
    </html>
  );
}
