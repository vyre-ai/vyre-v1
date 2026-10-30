// Test helpers for pressing things in a rendered tree: react-native-web renders through the test renderer with the few browser pieces it asks for stubbed, a press goes
// through the node's onClick, and the text of a tree can be read back. installDom() returns the function that puts the globals back, so a file's static-markup tests are untouched.
import { act } from "react";
import type { ReactElement } from "react";

export interface Node { props: Record<string, unknown>; children?: (Node | string)[] }

export const find = (n: Node, id: string): Node | null => {
  if (n.props?.["data-testid"] === id || n.props?.testID === id) return n;
  for (const c of n.children ?? []) { if (typeof c === "object") { const f = find(c, id); if (f) return f; } }
  return null;
};

export const textOf = (n: Node | string | null): string => (n === null ? "" : typeof n === "string" ? n : (n.children ?? []).map(textOf).join(" "));

/** Call at the start of a test, after the imports have loaded: react-native-web must load without a document, and render with one. */
export function installDom(): () => void {
  const g = globalThis as Record<string, unknown>;
  const had = { window: "window" in g, Image: "Image" in g, document: "document" in g };
  g["IS_REACT_ACT_ENVIRONMENT"] = true;
  if (!had.window) g["window"] = globalThis;
  if (!had.Image) g["Image"] = class { onload: unknown; onerror: unknown; set src(_v: string) { /* never loads */ } };
  if (!had.document) g["document"] = { createElement: () => ({ style: {}, setAttribute: () => undefined, appendChild: () => undefined }), head: { appendChild: () => undefined }, getElementById: () => null, documentElement: { getAttribute: () => null, setAttribute: () => undefined, style: {} }, addEventListener: () => undefined };
  const stub = { value: () => undefined, configurable: true, enumerable: false, writable: true };
  Object.defineProperty(Object.prototype, "addEventListener", stub);
  Object.defineProperty(Object.prototype, "removeEventListener", stub);
  return () => {
    delete (Object.prototype as unknown as Record<string, unknown>)["addEventListener"];
    delete (Object.prototype as unknown as Record<string, unknown>)["removeEventListener"];
    if (!had.window) delete g["window"];
    if (!had.Image) delete g["Image"];
    if (!had.document) delete g["document"];
  };
}

/** Renders an element with the test renderer (pass its createRoot: only test files may import it) and returns its root. */
export async function mount(createRoot: () => { render(el: ReactElement): void; container: unknown }, el: ReactElement): Promise<Node> {
  const r = createRoot();
  await act(async () => { r.render(el); });
  await flush();
  return r.container as unknown as Node;
}

export const press = async (n: Node | null): Promise<void> => {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props.onClick as (e: unknown) => void)({ stopPropagation() {}, preventDefault() {}, altKey: false, target: { getAttribute: () => null }, currentTarget: { getAttribute: () => null }, nativeEvent: {} }); });
};
export const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
