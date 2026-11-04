// Helpers the Add people and agents tests share: the DOM, the sheet, picking rows, and a right-click on a row.
import { Dimensions } from "react-native";
import { installDom, mount, press, find, flush, typeInto, textOf } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { createSample as createPane } from "../rightpane/sample.ts";
import { ProjectPage, ProjectPageDataProvider } from "../../records/projectpage/index.ts";
import { createSampleProject } from "../../records/projectpage/sample.ts";
import { useAddSheet } from "./index.ts";
import type { AddSheetApi } from "./index.ts";
import { addedLine, directoryOf, failedLine, hereSub, maxLevelOf, projectExtras, settingsOf } from "./model.ts";

installComposerForTests(Composer);
export const widen = (width: number): void => Dimensions.set({ window: { width, height: 844, scale: 1, fontScale: 1 } });
export const SHEET = "add-sheet";

export async function withDom<T>(run: () => Promise<T>): Promise<T> {
  const off = installDom();
  widen(1280);
  try { return await run(); } finally { off(); widen(1280); }
}

export const testIds = (n: Node | string, out: string[] = []): string[] => { if (typeof n === "string") return out; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach((c) => testIds(c, out)); return out; };

/** The sheet is open: pick people and agents by their row and press Add. */
export async function pickAndAdd(root: Node, ids: string[]): Promise<void> {
  for (const id of ids) await press(find(root, `as-row-${id}`));
  await press(find(root, "as-add"));
  await flush();
}

/* ---------- one sheet, every entry point ---------- */


