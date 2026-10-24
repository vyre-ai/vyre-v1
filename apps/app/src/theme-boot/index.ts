// App boot for the theme (spec: no theme flash). Choice resolution lives in ui/src/theme so the
// web head script, the native first render and the live controller can never disagree.
//   Web: put HEAD_SCRIPT first in <head> (webDocument does it for the built index.html).
//   Native: call nativeRoot before the first render and pass rootStyle to the root view.

import { beforeFirstRender, headScript, installHead } from "../../../../ui/src/theme/index.ts";
import type { NativeTheme, ThemeInput } from "../../../../ui/src/theme/index.ts";

export const HEAD_SCRIPT: string = headScript();

export function webDocument(html: string): string {
  return installHead(html, HEAD_SCRIPT);
}

export function nativeRoot(input: ThemeInput): NativeTheme {
  return beforeFirstRender(input);
}
