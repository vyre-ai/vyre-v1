// Frozen props for the composer shell (spec 4.6 and 3.0).
// One shell for chats, threads, Ask panes, inbox, record comments and task threads.
// Symbols: @ people and agents, # things, / commands. [[ links a record.
// The who-will-answer line is always shown. Recipients mount above the field when it sends outside.

export const COMPOSER_SYMBOLS = ["at", "hash", "slash"] as const;

export type ComposerSymbol = (typeof COMPOSER_SYMBOLS)[number];

export interface ComposerChip {
  kind: string;
  name: string;
}

export interface ComposerAttachment {
  name: string;
}

export interface ComposerShellProps {
  whoWillAnswer: string;
  placeholder?: string;
  label?: string;
  value?: string;
  lead?: string;
  working?: boolean;
  /** When true, the shell reserves the recipients slot above the field. */
  sendsOutside?: boolean;
  symbols?: readonly ComposerSymbol[];
  chips?: readonly ComposerChip[];
  attachments?: readonly ComposerAttachment[];
  /** Quiet line after an engine switch. */
  engineLine?: string;
  onSend?: (text: string) => void;
  onStop?: () => void;
}

const SYMBOL_MARK: Record<ComposerSymbol, string> = {
  at: "@",
  hash: "#",
  slash: "/",
};

export function composerSymbols(props: ComposerShellProps): readonly ComposerSymbol[] {
  const wanted = new Set(props.symbols ?? COMPOSER_SYMBOLS);
  return COMPOSER_SYMBOLS.filter((symbol) => wanted.has(symbol));
}

export function symbolMark(symbol: ComposerSymbol): string {
  return SYMBOL_MARK[symbol];
}
