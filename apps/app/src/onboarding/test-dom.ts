// Test helpers: react-native-web renders through the test renderer with the few browser pieces it asks for stubbed, and a press goes through the node's onClick.
import { act } from "react";

/** Call at the start of a test, after the imports have loaded: react-native-web must load without a document, and render with one. */
export function installDom(): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // react-native-web wants a browser: it reads window and listens on its host nodes. The test renderer has neither, so give it the two stand-ins it asks for.
  (globalThis as { window?: unknown }).window ??= globalThis;
  (globalThis as { Image?: unknown }).Image ??= class { onload: unknown; onerror: unknown; set src(_v: string) { /* never loads */ } };
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ style: {}, setAttribute: () => undefined, appendChild: () => undefined }), head: { appendChild: () => undefined }, getElementById: () => null, documentElement: { getAttribute: () => null, setAttribute: () => undefined, style: {} }, addEventListener: () => undefined };
  Object.defineProperty(Object.prototype, "addEventListener", { value: () => undefined, configurable: true, enumerable: false, writable: true });
  Object.defineProperty(Object.prototype, "removeEventListener", { value: () => undefined, configurable: true, enumerable: false, writable: true });
}

export interface Node { props: Record<string, unknown>; children?: Node[] }
export const find = (n: Node, id: string): Node | null => {
  if (n.props?.["data-testid"] === id || n.props?.testID === id) return n;
  for (const c of n.children ?? []) { if (typeof c === "object") { const f = find(c as Node, id); if (f) return f; } }
  return null;
};


export const press = async (n: Node | null): Promise<void> => { if (!n) throw new Error("node not found"); await act(async () => { (n.props.onClick as (e: unknown) => void)({ stopPropagation() {}, preventDefault() {}, altKey: false, target: { getAttribute: () => null }, currentTarget: { getAttribute: () => null }, nativeEvent: {} }); }); };
export const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
export const typeInto = async (n: Node | null, value: string): Promise<void> => { if (!n) throw new Error("node not found"); await act(async () => { (n.props.onChange as (e: unknown) => void)({ target: { value }, nativeEvent: { text: value }, currentTarget: { value } }); }); };
