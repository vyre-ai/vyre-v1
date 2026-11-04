// Switches on math (KaTeX) in chat replies: `katex` is in the lock, so this one is ready to import once, at the shell's startup:
//   import "../../ui/src/stream/enable-math.ts";
// KaTeX is loaded by a dynamic import the first time a reply holds a formula. It writes MathML, which needs no stylesheet or fonts and takes the page's own text colour, so paper and graphite both read.
import { setMathLoader } from "./loaders.ts";

setMathLoader(async () => {
  const katex = (await import("katex")).default;
  return async (tex, display) => katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "mathml", trust: false });
});
