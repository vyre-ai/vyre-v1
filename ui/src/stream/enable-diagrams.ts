// Switches on diagrams (Mermaid) in chat replies. Not imported by anything yet: `mermaid` is not in the lock (its dependencies elkjs and khroma fail the license check). When it is, one line turns diagrams on for the app:
//   import "../../ui/src/stream/enable-diagrams.ts";   (in the shell's startup, next to the other one-time setup)
// Both libraries are loaded by a dynamic import the first time a reply holds a diagram or a formula, so a chat without either never downloads them. Mermaid runs with securityLevel "strict" and its SVG is shown inside a
// sandboxed frame (Blocks.tsx); KaTeX writes MathML, which needs no stylesheet or fonts and takes the page's own text colour, so paper and graphite both read.
import { setDiagramLoader } from "./loaders.ts";

let n = 0;

// Mermaid is a static file of the app (apps/app/public/vendor/mermaid, the package's own mermaid.min.js, version 11.17.2) put in the page the first time a reply holds a diagram. Imported into the bundle it pulled
// three megabytes of its own code and shared libraries into the first download of every visit (r38: the sign-in page waited for them); as a file it costs a chat without a diagram nothing.
interface MermaidApi {
  initialize(o: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}
let loading: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  const g = globalThis as unknown as { mermaid?: MermaidApi; document?: Document; location?: { origin?: string } };
  if (g.mermaid !== undefined) return Promise.resolve(g.mermaid);
  loading ??= new Promise<MermaidApi>((ok, no) => {
    const el = g.document?.createElement("script");
    if (!el || !g.document) return no(new Error("no page"));
    const origin = g.location?.origin;
    el.src = `${origin !== undefined && origin !== "null" ? origin : ""}/vendor/mermaid/mermaid.min.js`;
    el.async = true;
    el.onload = () => (g.mermaid ? ok(g.mermaid) : no(new Error("Mermaid did not start")));
    el.onerror = () => no(new Error("could not load Mermaid"));
    g.document.head.appendChild(el);
  });
  void loading.catch(() => {
    loading = null;
  });
  return loading;
}

setDiagramLoader(async () => {
  const mermaid = await loadMermaid();
  return async (source, theme) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme.dark ? "dark" : "neutral",
      themeVariables: {
        background: "transparent",
        primaryColor: theme.sunk,
        primaryBorderColor: theme.line,
        primaryTextColor: theme.ink,
        lineColor: theme.ink,
        textColor: theme.ink,
        secondaryColor: theme.sunk,
        tertiaryColor: theme.win,
        fontFamily: "inherit",
      },
    });
    const out = await mermaid.render(`vyre-diagram-${++n}`, source);
    return out.svg;
  };
});
