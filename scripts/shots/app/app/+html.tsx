// Static document for the web export. The inline script sets the skin's CSS variables and the root background
// before the first frame, from the same token data native uses (@vyre/ui/tokens). ?skin=<id>&mode=<light|dark>.
import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { skins } from "@vyre/ui/tokens";
import { rootFontCss } from "@vyre/ui/src/theme/fonts.ts";

const data: Record<string, { base: string; light: Record<string, string>; dark: Record<string, string> }> = {};
for (const s of skins) data[s.id] = { base: s.base, light: s.light, dark: s.dark };

const BOOT = `(function(){try{var T=${JSON.stringify(data)};var q=new URLSearchParams(location.search);var id=q.get("skin")||"paper";var k=T[id]||T.paper;var m=q.get("mode")||k.base;var v=k[m];var r=document.documentElement,s=r.style;for(var n in v)s.setProperty(n,v[n]);s.backgroundColor=v["--win"];s.colorScheme=m;r.setAttribute("data-skin",id);r.setAttribute("data-mode",m);window.__VYRE_THEME_AT__=performance.now();}catch(e){}})();`;

// headNodes and bodyNodes carry the bundle script tags and CSS Expo injects at export. A custom document that omits them
// ships pages with no JavaScript (SDK 58), so they are rendered here.
export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <ScrollViewStyleReset />
        <style id="vyre-root-font" dangerouslySetInnerHTML={{ __html: rootFontCss() }} />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
