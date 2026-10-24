// App boot for theme. Web: the blocking head script is the first child of head.
// Native: nativeRoot is called before the first render and its rootStyle is the initial style.
// Choice resolution lives in ui/src/theme so the head script and the native path stay the same.

import { beforeFirstRender, headScript, installHead, SEED_SPACES } from "../../../../ui/src/theme/index.ts";
import type { NativeTheme, ThemeInput } from "../../../../ui/src/theme/index.ts";

export { SEED_SPACES };

export const HEAD_SCRIPT: string = headScript();

export function webDocument(html: string): string {
  return installHead(html, HEAD_SCRIPT);
}

export function nativeRoot(input: ThemeInput): NativeTheme {
  return beforeFirstRender(input);
}
