// /claim/<token>: the one-time link the daemon prints on a fresh install. The root layout draws the claim screen; this route only makes the address valid for the router and the static export.
export function generateStaticParams(): { token: string }[] {
  return [{ token: "claim-link" }];
}

export default function ClaimRouteStub() {
  return null;
}
