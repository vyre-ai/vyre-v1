// Static document for the web export. The inline script marks app.start, sets the skin's CSS variables before first paint
// (same data as native) and registers the service worker after load. headNodes and bodyNodes carry the bundle script tags
// and CSS Expo injects at export; a custom document that leaves them out ships pages with no JavaScript (SDK 58).
// The manifest and Apple metadata are in this document so static export carries the same install contract as the live app,
// including iPhone's safe-area viewport.
import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { bootScript } from "../src/startup/boot.ts";
import { rootFontCss } from "@vyre/ui/src/theme/fonts.ts";

export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Vyre" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <style id="vyre-pwa-safe-area">{`:root {
          --vyre-safe-area-top: env(safe-area-inset-top, 0px);
          --vyre-safe-area-right: env(safe-area-inset-right, 0px);
          --vyre-safe-area-bottom: env(safe-area-inset-bottom, 0px);
          --vyre-safe-area-left: env(safe-area-inset-left, 0px);
        }
        html, body, #root { min-height: 100%; }
        body {
          margin: 0;
          padding: var(--vyre-safe-area-top) var(--vyre-safe-area-right) var(--vyre-safe-area-bottom) var(--vyre-safe-area-left);
          box-sizing: border-box;
        }`}</style>
        <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
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
