// ui/States: empty and offline show one line and one action; error shows what, why, next, trace id and three actions.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { States, ICON_PATHS, isStateIcon } from "./index.tsx";
import { STATE_ICONS } from "./props.ts";

test("empty shows its line and one primary action", () => {
  const html = renderToStaticMarkup(<States kind="empty" title="No files yet" action={{ label: "Upload", onPress: () => {} }} />);
  assert.match(html, /No files yet/);
  assert.equal(html.match(/data-testid="state-action"/g)?.length, 1);
  assert.match(html, /data-icon="search"/);
});

test("offline defaults to the offline icon and may omit the action", () => {
  const html = renderToStaticMarkup(<States kind="offline" title="You are offline" />);
  assert.match(html, /data-icon="offline"/);
  assert.doesNotMatch(html, /state-action/);
});

test("error shows what, why, next, trace id and Copy trace id plus Report a problem", () => {
  const html = renderToStaticMarkup(
    <States kind="error" message="Could not load records" cause="The server did not answer" next="Check the connection" code="E_NET" traceId="tr_123" />,
  );
  for (const text of ["Could not load records", "The server did not answer", "Check the connection", "E_NET", "tr_123", "Copy trace id", "Report a problem"]) {
    assert.ok(html.includes(text), text);
  }
  assert.doesNotMatch(html, /state-retry/, "no Retry when the error is not retryable");
});

test("a retryable error offers Retry", () => {
  const html = renderToStaticMarkup(<States kind="error" message="Failed" retryable onRetry={() => {}} />);
  assert.match(html, /data-testid="state-retry"/);
});

test("every named icon has a path", () => {
  for (const name of STATE_ICONS) {
    assert.ok(isStateIcon(name));
    assert.ok(ICON_PATHS[name].length > 0, name);
  }
});
