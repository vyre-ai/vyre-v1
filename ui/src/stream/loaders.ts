// Diagrams and math need big libraries (Mermaid, KaTeX) that a message only pays for when it uses them. They are loaded the first time a message needs one, through a loader the app registers; until
// one is registered, or if it fails, the reply shows the source with a line saying why, never a blank or a crash. A loader returns an SVG or HTML string; a diagram is shown inside a sandboxed frame.
/** Thrown when no renderer is switched on: not a failure, so the reply says only what it shows instead. */
export class NotEnabled extends Error {}

export type DiagramRender = (source: string, theme: DiagramTheme) => Promise<string>;
export type MathRender = (tex: string, display: boolean) => Promise<string>;

/** The skin's colours, read from the page when a diagram is drawn, so paper and graphite each get their own. */
export interface DiagramTheme { ink: string; sunk: string; line: string; accent: string; win: string; dark: boolean }

let diagram: (() => Promise<DiagramRender>) | null = null;
let math: (() => Promise<MathRender>) | null = null;
const cache = new Map<string, Promise<string>>();
let diagramFn: Promise<DiagramRender> | null = null;
let mathFn: Promise<MathRender> | null = null;

/** The app registers how to load Mermaid (a dynamic import that resolves to a render function). */
export function setDiagramLoader(load: (() => Promise<DiagramRender>) | null): void { diagram = load; diagramFn = null; cache.clear(); }
export function setMathLoader(load: (() => Promise<MathRender>) | null): void { math = load; mathFn = null; cache.clear(); }
export const hasDiagramLoader = (): boolean => diagram !== null;
export const hasMathLoader = (): boolean => math !== null;


/** The SVG for a diagram source, drawn once per source and theme. Rejects with a sentence when there is no loader or the source does not draw. */
export function renderDiagram(source: string, theme: DiagramTheme): Promise<string> {
  const key = `d:${theme.dark ? "d" : "l"}:${source}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const run = (async () => {
    if (!diagram) throw new NotEnabled("Showing the diagram's source");
    diagramFn ??= diagram();
    const fn = await diagramFn;
    return fn(source, theme);
  })();
  cache.set(key, run);
  run.catch(() => cache.delete(key));
  return run;
}

export function renderMath(tex: string, display: boolean): Promise<string> {
  const key = `m:${display ? 1 : 0}:${tex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const run = (async () => {
    if (!math) throw new NotEnabled("Showing the formula as written");
    mathFn ??= math();
    const fn = await mathFn;
    return fn(tex, display);
  })();
  cache.set(key, run);
  run.catch(() => cache.delete(key));
  return run;
}
