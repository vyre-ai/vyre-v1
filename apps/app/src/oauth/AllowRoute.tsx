// /oauth/allow: the Allow page where a person has no Vyre app and a Space serves the web app, or a person opened the link in one. Not signed in here: the normal sign-in, then this same page. The tab the client opened keeps waiting
// and collects the sign-in by itself, so this window only answers.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { createCapCaller } from "../shell/session/caps.ts";
import { SessionGate } from "../shell/session/SessionGate.tsx";
import { readStored, spaceAddress } from "../shell/session/stored.ts";
import { AllowScreen } from "./AllowScreen.tsx";

const REQUEST = /^oar_[a-z0-9]{1,64}$/;
export const requestFrom = (search: string): string | null => { const r = new URLSearchParams(search).get("request"); return r !== null && REQUEST.test(r) ? r : null; };

export function AllowRoute(): ReactElement {
  const location = (globalThis as { location?: { search: string } }).location;
  const baseUrl = spaceAddress();
  const requestId = useMemo(() => requestFrom(location?.search ?? ""), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [stored, setStored] = useState(() => (baseUrl ? readStored(undefined, baseUrl) : null));
  useEffect(() => {
    if (stored || !baseUrl) return undefined;
    const t = setInterval(() => { const s = readStored(undefined, baseUrl); if (s) setStored(s); }, 500);
    return () => clearInterval(t);
  }, [stored, baseUrl]);
  const call = useMemo(() => (stored && baseUrl ? createCapCaller({ baseUrl, token: () => stored.token }) : null), [stored, baseUrl]);
  if (!requestId || !stored || !call) return <SessionGate />;
  return <AllowScreen call={call} requestId={requestId} me={stored.username ?? "you"} />;
}
