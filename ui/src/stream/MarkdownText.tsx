// Finished Markdown drawn by the chat's own block renderer: a note's words, a file, a runbook's prose, a reply that is done. The same blocks as a reply that is streaming (tables, checklists, callouts, code, charts,
// diagrams, math), so one message reads the same wherever it is shown. The text is parsed once per change; nothing here streams.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { createIncrementalMarkdown } from "./markdown.ts";
import { MarkdownBlocks } from "./Markdown.tsx";
import type { RenderCode, RenderLink, RenderText } from "./Markdown.tsx";

export interface MarkdownTextProps {
  text: string;
  onLink?: (href: string) => void;
  renderLink?: RenderLink;
  renderCode?: RenderCode;
  /** Draws plain words its own way (a note turns the file names in it into links). */
  renderText?: RenderText;
  testID?: string;
}

export function MarkdownText({ text, onLink, renderLink, renderCode, renderText }: MarkdownTextProps): ReactElement {
  const blocks = useMemo(() => {
    const md = createIncrementalMarkdown();
    // front matter (a SKILL.md header) is shown as the YAML it is
    md.append(text.replace(/^---\n([\s\S]*?)\n---\n/, "```yaml\n$1\n```\n\n"));
    md.finish();
    return md.view().blocks;
  }, [text]);
  return <MarkdownBlocks blocks={blocks} {...(onLink ? { onLink } : {})} {...(renderLink ? { renderLink } : {})} {...(renderCode ? { renderCode } : {})} {...(renderText ? { renderText } : {})} />;
}
