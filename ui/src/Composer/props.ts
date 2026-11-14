// Frozen props for the composer shell (spec 4.6 and 3.0).
// One shell for chats, threads, Ask panes, inbox, record comments and task threads.
// Symbols: @ people and agents, # things, / commands. [[ links a record.
// The who-will-answer line is always shown. Recipients mount above the field when it sends outside.

export const COMPOSER_SYMBOLS = ["at", "hash", "slash"] as const;

export type ComposerSymbol = (typeof COMPOSER_SYMBOLS)[number];

export interface ComposerChip {
  kind: string;
  name: string;
  /** What the chip points at (a record, file, folder or channel id), when the list that offered it knew. */
  id?: string;
}

/** A file in the tray. `file` is the browser File (or any Blob-like) behind it, so the sender can read the bytes; a name alone is a file the caller already holds. */
export interface ComposerAttachment {
  name: string;
  file?: unknown;
  size?: number;
  mime?: string;
  /** A file already kept in Vyre Files (picked with From Files): sent as the file itself, nothing is uploaded. */
  fileId?: string;
}

/** Something linked from the text with [[ ]] : what it is, which one, and the words shown. */
export interface ComposerRef {
  kind: string;
  id: string;
  title: string;
  /** "#" for a thing picked with # and drawn as an inline token ("#Title" in the text); left out for a [[link]]. */
  token?: "#";
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
