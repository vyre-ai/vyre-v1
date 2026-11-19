// What the agent that started a helper reads of the helper's answer (r42-runtime-tokens, DIRECTION-agent-runtime C; lead, 19 Nov: nothing silently truncated). Before, the parent got the first 1,500 characters and a
// cut with no mark. Now the parent always gets, whole: a summary (what the helper put first, or the whole answer when it is short), the structured fields the helper gave, and a reference to the full text.
// People still read the full result in the helper's own pane. Pure functions, no clock and no I/O.

/** An answer up to this long reaches the parent whole, as before. */
export const RESULT_WHOLE = 1_500;
/** The longest summary the parent is handed; a longer first part is split at a paragraph and the rest is detail. */
export const SUMMARY_MAX = 1_500;
/** Structured fields (a fenced json block named result) up to this long are handed whole. */
export const FIELDS_MAX = 2_000;

export interface Split {
  summary: string;
  /** The helper's own structured fields, as it wrote them, or undefined. */
  fields?: string;
  /** What the parent does not see in its body and reads by reference: empty when the parent has everything. */
  detail: string;
}

const FENCE = /```json[ \t]+result[ \t]*\n([\s\S]*?)\n```/;
const RULE = /\n[ \t]*---[ \t]*\n/;

/**
 * Split a helper's final words. A short answer is all summary. A long one is cut where the helper put its own line of three dashes, else at the last paragraph break inside SUMMARY_MAX, else at the
 * last line break, else at SUMMARY_MAX. In every case `summary + fields + detail` holds every character the helper wrote (apart from the fence of the fields), so nothing is lost: the reference gives the rest.
 */
export function splitResult(text: string): Split {
  let rest = text.trim();
  let fields: string | undefined;
  const f = FENCE.exec(rest);
  if (f && f[1]!.trim().length <= FIELDS_MAX) {
    fields = f[1]!.trim();
    rest = `${rest.slice(0, f.index)}${rest.slice(f.index + f[0].length)}`.replace(/\n{3,}/g, "\n\n").trim();
  }
  if (rest.length <= RESULT_WHOLE) return { summary: rest, ...(fields ? { fields } : {}), detail: "" };
  const m = RULE.exec(rest);
  if (m && m.index <= SUMMARY_MAX) {
    return {
      summary: rest.slice(0, m.index).trim(),
      ...(fields ? { fields } : {}),
      detail: rest.slice(m.index + m[0].length).trim(),
    };
  }
  const head = rest.slice(0, SUMMARY_MAX);
  const at = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"), -1);
  const cut = at > SUMMARY_MAX / 3 ? at : SUMMARY_MAX;
  return { summary: rest.slice(0, cut).trim(), ...(fields ? { fields } : {}), detail: rest.slice(cut).trim() };
}

/** The words the parent agent reads for a finished helper. `ref` is where the full text is; without one the parent is told where to look. */
export function parentBody(title: string, text: string, ref?: { threadId: string; messageId: string }): string {
  if (text.trim() === "") return `Helper "${title}" found:\n\n(it ended with no words)`;
  const s = splitResult(text);
  const parts = [`Helper "${title}" found:`, s.summary];
  if (s.fields) parts.push(`Fields:\n${s.fields}`);
  if (s.detail !== "") {
    parts.push(
      ref
        ? `Full result (${text.trim().length.toLocaleString("en-US")} characters, ${s.detail.length.toLocaleString("en-US")} not shown here): read it with chat_message_get {threadId "${ref.threadId}", messageId "${ref.messageId}"}.`
        : `The rest of the result (${s.detail.length.toLocaleString("en-US")} characters) is in the helper's own chat.`,
    );
  }
  return parts.join("\n\n");
}
