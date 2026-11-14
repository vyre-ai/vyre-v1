// The last net under the app: a crash after the app has started says so (it was not starting), keeps Retry, and logs the component stack so a production error number (React 185, maximum update depth) names the screen.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { flush, installDom, textOf } from "../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../ui/src/testing/dom.ts";
import { RootBoundary } from "./AppRoot.tsx";

function Boom(): never {
  throw new Error("Maximum update depth exceeded");
}

test("a crash after start: the page says Vyre stopped, not that it could not start, and Retry stays", async () => {
  const off = installDom();
  const logged: string[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => {
    logged.push(a.map(String).join(" "));
  };
  try {
    const r = createRoot();
    await act(async () => {
      r.render(
        <RootBoundary>
          <Boom />
        </RootBoundary>,
      );
    });
    await flush();
    const text = textOf(r.container as unknown as Node);
    assert.match(text, /Vyre stopped working/);
    assert.doesNotMatch(text, /while it started|Couldn't open Vyre/);
    assert.match(text, /Retry/);
    assert.ok(
      logged.some((l) => l.includes("vyre root crashed: Maximum update depth exceeded") && l.includes("Boom")),
      "the log names the component that threw",
    );
  } finally {
    console.error = was;
    off();
  }
});
