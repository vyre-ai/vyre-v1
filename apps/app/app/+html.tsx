// Static document for the web export. The inline script marks app.start, sets the skin's CSS variables before first paint
// (same data as native) and registers the service worker after load. headNodes and bodyNodes carry the bundle script tags
// and CSS Expo injects at export; a custom document that leaves them out ships pages with no JavaScript (SDK 58).
import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { bootScript } from "../src/startup/boot.ts";
import { rootFontCss } from "@vyre/ui/theme/fonts";

export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
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
