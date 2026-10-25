// A streaming message body: the store's blocks drawn as markdown, with the caret while it is still coming.
import { useStream } from "./useStream.ts";
import { MarkdownBlocks } from "./Markdown.tsx";
import type { StreamStore } from "./store.ts";

export interface StreamTextProps {
  store: StreamStore;
  onLink?: (href: string) => void;
}

export function StreamText({ store, onLink }: StreamTextProps) {
  const snap = useStream(store);
  return <MarkdownBlocks blocks={snap.blocks} streaming={!snap.done} {...(onLink ? { onLink } : {})} />;
}
