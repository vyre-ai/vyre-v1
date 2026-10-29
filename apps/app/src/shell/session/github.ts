// GitHub sign-in, the app's side. The Space owns the browser leg (/auth/github/start and /callback); it sends the browser back here with GitHub's one-use code in the URL fragment.
export const GITHUB_FAILED_LINE = "GitHub sign-in did not finish. Try again or use your password.";
export const GITHUB_SECOND_FACTOR_LINE = "This Space asks for a second factor. Sign in with your password and code.";

/** Where the Space's own start route sends the browser to GitHub, and back to `returnTo` afterwards. */
export function githubStartUrl(baseUrl: string, returnTo: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/auth/github/start?return=${encodeURIComponent(returnTo)}`;
}

export type GithubReturn = { code: string } | { error: true } | null;

/** Read, and remove from the address bar, what the callback left in the fragment. */
export function takeGithubReturn(loc: { hash: string; pathname: string; search: string } | undefined, replace: (url: string) => void): GithubReturn {
  if (!loc) return null;
  const p = new URLSearchParams(loc.hash.replace(/^#/, ""));
  const code = p.get("github_code"), failed = p.get("github_error");
  if (!code && !failed) return null;
  replace(`${loc.pathname}${loc.search}`);
  return code ? { code } : { error: true };
}
