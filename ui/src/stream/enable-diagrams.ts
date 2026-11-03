// Switches on diagrams (Mermaid) and math (KaTeX) in chat replies. Not imported by anything yet: it needs `mermaid` and `katex` in package.json, which an install adds. After that, one line turns both on for the app:
//   import "../../ui/src/stream/enable-diagrams.ts";   (in the shell's startup, next to the other one-time setup)
// Both libraries are loaded by a dynamic import the first time a reply holds a diagram or a formula, so a chat without either never downloads them. Mermaid runs with securityLevel "strict" and its SVG is shown inside a
// sandboxed frame (Blocks.tsx); KaTeX writes MathML, which needs no stylesheet or fonts and takes the page's own text colour, so paper and graphite both read.
import { setDiagramLoader, setMathLoader } from "./loaders.ts";

let n = 0;

setDiagramLoader(async () => {
  const mermaid = (await import("mermaid")).default;
  return async (source, theme) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme.dark ? "dark" : "neutral",
      themeVariables: { background: "transparent", primaryColor: theme.sunk, primaryBorderColor: theme.line, primaryTextColor: theme.ink, lineColor: theme.ink, textColor: theme.ink, secondaryColor: theme.sunk, tertiaryColor: theme.win, fontFamily: "inherit" },
    });
    const out = await mermaid.render(`vyre-diagram-${++n}`, source);
    return out.svg;
  };
});

setMathLoader(async () => {
  const katex = (await import("katex")).default;
  return async (tex, display) => katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "mathml", trust: false });
});
