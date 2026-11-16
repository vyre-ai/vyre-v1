// The signer's page (lane r33-sign-ui). `signShell()` is the one HTML document `GET /p/sign/<token>/` returns for every token (it never reads state, so a mail scanner opening the link changes nothing);
// `signAsset(name)` is a file of `/p/sign/<token>/assets/<name>`. The page is plain HTML and one module script, in the style of the forms page: no React, no app UI kit, no cookie, no storage, and every address
// relative to the token's own, so nothing leaves /p/ and the relay needs no change. pdf.js (Apache-2.0) and the signature face (Dancing Script, SIL OFL 1.1) are served from sign-assets/ with their licences.
import { readFileSync } from "node:fs";

const DIR = new URL("./sign-assets/", import.meta.url);
// the served name, the file under sign-assets/ and its type; third-party files sit in vendor/ with their licences
const FILES: Record<string, { file: string; mime: string }> = {
  "sign.css": { file: "sign.css", mime: "text/css; charset=utf-8" },
  "sign.js": { file: "sign.js", mime: "text/javascript; charset=utf-8" },
  "pdf.js": { file: "vendor/pdf.js", mime: "text/javascript; charset=utf-8" },
  "pdf.worker.classic.js": { file: "vendor/pdf.worker.classic.js", mime: "text/javascript; charset=utf-8" },
  "script.woff2": { file: "vendor/script.woff2", mime: "font/woff2" },
  "script-OFL.txt": { file: "vendor/script-OFL.txt", mime: "text/plain; charset=utf-8" },
  "pdf-LICENSE.txt": { file: "vendor/pdf-LICENSE.txt", mime: "text/plain; charset=utf-8" },
};
const cache = new Map<string, Uint8Array>();

export function signAsset(name: string): { mime: string; bytes: Uint8Array } | null {
  const entry = Object.hasOwn(FILES, name) ? FILES[name] : undefined;
  if (!entry || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  let bytes = cache.get(name);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(new URL(entry.file, DIR)));
    cache.set(name, bytes);
  }
  return { mime: entry.mime, bytes };
}

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Sign a document</title>
<link rel="stylesheet" href="./assets/sign.css">
<script type="module" src="./assets/sign.js"></script>
</head>
<body>
<a class="skip" href="#app">Skip to the document</a>
<header class="top" id="top" hidden><div class="top-in"><span class="space" id="space"></span><span class="doc-title" id="doctitle"></span></div></header>
<main id="app"><div class="center"><p class="dim">Opening</p></div></main>
<noscript><main><p>This page needs JavaScript to show the document and take a signature.</p></main></noscript>
</body>
</html>
`;

export const signShell = (): string => SHELL;
