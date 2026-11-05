// The AI account a link asked for (settings.page with page "ai" and account <handle>, as a failed turn's Sign in again opens it): Your AI scrolls to that account and starts its sign-in.
import { createContext, useContext } from "react";
export const AskedAccount = createContext<string | null>(null);
export const useAskedAccount = (): string | null => useContext(AskedAccount);
/** Does the account the link named (its handle, ref or provider id, with or without the #) mean this one? */
export function isAskedAccount(asked: string | null, a: { ref: string; providerId?: string | undefined; name?: string | undefined }): boolean {
  if (!asked) return false;
  const bare = (x: string): string => x.replace(/^#/, "").trim().toLowerCase();
  const want = bare(asked);
  return [a.ref, a.providerId ?? "", a.name ?? ""].some((x) => x !== "" && bare(x) === want);
}
