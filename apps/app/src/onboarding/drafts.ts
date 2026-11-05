// What a person has chosen on a setup step, kept for the run of the app so moving between steps loses nothing: a card that is reopened starts from this, not from blank. Plain data, no React.
const drafts = new Map<string, unknown>();
export const draftGet = <T,>(key: string): T | undefined => drafts.get(key) as T | undefined;
export const draftSet = (key: string, value: unknown): void => { drafts.set(key, value); };
export const draftClear = (key?: string): void => { if (key === undefined) drafts.clear(); else drafts.delete(key); };
