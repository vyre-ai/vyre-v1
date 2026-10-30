// Sign in with the firm's own Google or Microsoft app, the app's side. The Space owns the browser leg (/auth/sso/<provider>/start and /callback); it sends the browser back here with a one-use
// ticket in the URL fragment, which identity.sso_sign_in spends.
export const SSO_FAILED_LINE = "Single sign-on did not finish. Try again or use your password.";
export const SSO_SECOND_FACTOR_LINE = "This Space asks for a second factor. Sign in with your password and code.";

export function ssoStartUrl(baseUrl: string, provider: string, returnTo: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/auth/sso/${encodeURIComponent(provider)}/start?return=${encodeURIComponent(returnTo)}`;
}

export type SsoReturn = { code: string; provider: string } | { error: true } | null;

/** Read, and remove from the address bar, what the callback left in the fragment. */
export function takeSsoReturn(loc: { hash: string; pathname: string; search: string } | undefined, replace: (url: string) => void): SsoReturn {
  if (!loc) return null;
  const p = new URLSearchParams(loc.hash.replace(/^#/, ""));
  const code = p.get("sso_code"), provider = p.get("sso_provider"), failed = p.get("sso_error");
  if (!code && !failed) return null;
  replace(`${loc.pathname}${loc.search}`);
  return code && provider ? { code, provider } : { error: true };
}
