// Setting up this computer's own Personal Space shows no fingerprint: there is no server whose printed fingerprint to compare it with. A Space claimed from a link still shows it.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimRoute } from "./ClaimRoute.tsx";

const fragment = "#s=spc_0123456789abcdef0123456789abcdef&n=Personal&fp=604cda66edfbb3cf";
const noop = (): void => undefined;

test("a local Personal Space setup hides the fingerprint; a server's claim link shows it", () => {
  const local = renderToStaticMarkup(<ClaimRoute token="t" address="http://127.0.0.1:1" fragment={fragment} deviceClass="desktop" local onDone={noop} onSignIn={noop} />);
  assert.doesNotMatch(local, /claim-fingerprint|Fingerprint 604c/);
  const remote = renderToStaticMarkup(<ClaimRoute token="t" address="https://box.example.com" fragment={fragment} onDone={noop} onSignIn={noop} />);
  assert.match(remote, /Fingerprint 604c da66 edfb b3cf/);
});
