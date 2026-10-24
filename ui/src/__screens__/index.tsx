// Screen page for frozen props batch 3. String markup, no renderer.
// Renders Softphone, Terminal, EmailBuilder, Viewer, each native block, and one unknown block.

import { SoftphonePlaceholder } from "../Softphone/Placeholder.tsx";
import type { SoftphoneProps } from "../Softphone/props.ts";
import { TerminalPlaceholder } from "../Terminal/Placeholder.tsx";
import type { TerminalProps } from "../Terminal/props.ts";
import { EmailBuilderPlaceholder } from "../EmailBuilder/Placeholder.tsx";
import type { EmailBuilderProps } from "../EmailBuilder/props.ts";
import { ViewerPlaceholder } from "../Viewer/Placeholder.tsx";
import type { ViewerProps } from "../Viewer/props.ts";
import { renderBlock, sampleNativeBlocks, unknownBlockSample } from "../blocks/registry.ts";
import { isKitScreen, type KitScreenDef } from "../kit/types.ts";

export const softphoneSample: SoftphoneProps = {
  open: true,
  mode: "incoming",
  density: "regular",
  numbers: [{ id: "n1", label: "Main", num: "+1 415 555 0100" }],
  fromId: "n1",
  caller: { name: "Maya Chen", number: "+1 415 555 0148", company: "Northwind", recordId: "rec_maya" },
  consent: false,
};

export const terminalSample: TerminalProps = {
  sessionId: "term_1",
  title: "Intake computer",
  host: "agent",
  hostLabel: "Intake computer",
  command: "git status",
  output: "clean",
  starred: true,
  density: "regular",
};

export const emailSample: EmailBuilderProps = {
  id: "em_1",
  title: "Email 1",
  subject: "Welcome",
  mode: "visual",
  focus: false,
  blocks: [{ id: "b1", kind: "text", text: "Hello" }],
  version: 1,
  density: "regular",
  diffs: [{ id: "d1", summary: "Shorter subject", accepted: false }],
};

export const viewerSample: ViewerProps = {
  fileId: "file_1",
  title: "client-intake.pdf",
  kind: "document",
  pane: "side",
  tool: "comment",
  pins: [{ id: "p1", n: 1, text: "Check the date" }],
  density: "regular",
};

export const viewerScreen: KitScreenDef = {
  id: "files.viewer",
  place: "files",
  slot: "side",
  builtin: "ui:Viewer",
  queries: {},
  actions: {},
  states: {
    empty: { line: "Nothing to preview" },
    offline: { line: "Offline" },
    error: { line: "Could not open the file", primary: "Try again" },
  },
};

export function renderScreen(): string {
  const kit = isKitScreen(viewerScreen) ? "ok" : "bad";
  const parts: string[] = [
    `<main data-screen="batch3" data-screen-id="files.viewer" data-kit-screen="${kit}">`,
    SoftphonePlaceholder(softphoneSample),
    TerminalPlaceholder(terminalSample),
    EmailBuilderPlaceholder(emailSample),
    ViewerPlaceholder(viewerSample),
  ];
  for (const block of sampleNativeBlocks()) parts.push(renderBlock(block));
  parts.push(renderBlock(unknownBlockSample));
  parts.push("</main>");
  return parts.join("");
}
