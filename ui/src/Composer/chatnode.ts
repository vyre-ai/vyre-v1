// The chat field's TipTap pieces: a paragraph of text, hard breaks, history and the mention chip, an inline atom whose text is the mention's own words. Loaded when a field mounts.
import { Node } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";

export const Chip = Node.create({
  name: "chip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { text: { default: "" }, kind: { default: "mention" } }; },
  parseHTML() { return [{ tag: "span.vyre-chip" }]; },
  renderHTML({ node }) { return ["span", { class: "vyre-chip", "data-kind": String(node.attrs["kind"] ?? "mention") }, String(node.attrs["text"] ?? "")]; },
  renderText({ node }) { return String(node.attrs["text"] ?? ""); },
});

export const chatExtensions = (): Extensions => [Document, Paragraph, Text, HardBreak, History, Chip];
