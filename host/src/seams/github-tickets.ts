// What the host holds between GitHub's answer and the person it belongs to (lane l-ci-runners): one place, in memory only, for two hand-offs that make connecting GitHub and signing in with GitHub one thing.
//   link ticket   github.me.complete has a verified GitHub identity; the ticket lets identity.github_link link it to the account without a second code (a code is single use). Redeemed once, only by the link.
//   pending       a sign-in with GitHub got tokens from an app that issues expiring ones; they wait two minutes under the GitHub id for the sign-in to finish, then github.adopt_sign_in takes them for the
//                 person who signed in, and the person is connected without doing anything more.
// Nothing here is written to disk, an event or a log. A ticket is 24 random bytes.
export interface GithubUserTokens { accessToken: string; refreshToken: string; expiresAt: number }
export interface GithubTickets {
  mintLink(who: { id: string; login: string }): string;
  /** Once: who the ticket vouches for, or null (unknown, used or too old). */
  takeLink(ticket: string): { id: string; login: string } | null;
  holdPending(who: { id: string; login: string }, tokens: GithubUserTokens): void;
  /** Once: the tokens a sign-in left for this GitHub id, or null. */
  takePending(githubId: string): { login: string; tokens: GithubUserTokens } | null;
}

export const LINK_PREFIX = "vyre-gh-link.";
const LINK_MS = 10 * 60_000, PENDING_MS = 2 * 60_000, CAP = 500;

export function createGithubTickets(now: () => number = Date.now): GithubTickets {
  const links = new Map<string, { id: string; login: string; exp: number }>();
  const pending = new Map<string, { login: string; tokens: GithubUserTokens; exp: number }>();
  const sweep = (): void => { const t = now(); for (const [k, v] of links) if (v.exp < t) links.delete(k); for (const [k, v] of pending) if (v.exp < t) pending.delete(k); };
  return {
    mintLink(who) {
      sweep();
      if (links.size >= CAP) links.delete(links.keys().next().value as string);
      const ticket = LINK_PREFIX + Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
      links.set(ticket, { ...who, exp: now() + LINK_MS });
      return ticket;
    },
    takeLink(ticket) {
      sweep();
      const v = links.get(ticket);
      links.delete(ticket);
      return v ? { id: v.id, login: v.login } : null;
    },
    holdPending(who, tokens) {
      sweep();
      if (pending.size >= CAP) pending.delete(pending.keys().next().value as string);
      pending.set(who.id, { login: who.login, tokens, exp: now() + PENDING_MS });
    },
    takePending(githubId) {
      sweep();
      const v = pending.get(githubId);
      pending.delete(githubId);
      return v ? { login: v.login, tokens: v.tokens } : null;
    },
  };
}
