// Canonical anonymous invite links use /join/<one-time-code>#fp=... .
// The root SessionGate reads the link after hydration and previews it before signup.
export function generateStaticParams():{code:string}[]{return[{code:'invite-link'}];}
export default function InviteRouteStub(){return null;}
