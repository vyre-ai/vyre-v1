// The one sheet frame at its sizes: s, m, l and full. A full sheet has a header slot, a bar slot under it, no padding, a Close control that is always there, and (with captureKeys) the chord in plain words.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { Dialog } from "./index.tsx";

const noop = (): void => {};

test("a full sheet draws its header, its bar, its body and a Close control that closes", () => {
  const html = renderToStaticMarkup(
    <Dialog
      title="Dex's terminal"
      size="full"
      header={<Text>Dex, owned by Dana</Text>}
      bar={<Text>Nobody is typing</Text>}
      captureKeys={{ chord: "Cmd+Shift+.", hint: "Cmd+Shift+. leaves the terminal" }}
      testID="sheet"
      onClose={noop}
    >
      <Text>the surface</Text>
    </Dialog>,
  );
  for (const t of ["Dex, owned by Dana", "Nobody is typing", "the surface", "Cmd+Shift+. leaves the terminal"])
    assert.ok(html.includes(t), t);
  assert.match(html, /data-testid="sheet-close"/);
  assert.ok(
    html.indexOf("Dex, owned by Dana") < html.indexOf("Nobody is typing") &&
      html.indexOf("Nobody is typing") < html.indexOf("the surface"),
    "header, then bar, then body",
  );
  assert.match(html, /role="dialog"/);
});

test("a full sheet without captured keys still has Close and says no chord", () => {
  const html = renderToStaticMarkup(
    <Dialog title="Browser" size="full" onClose={noop}>
      <Text>x</Text>
    </Dialog>,
  );
  assert.match(html, /data-testid="sheet-close"/);
  assert.doesNotMatch(html, /leaves the/);
});

test("the smaller sizes keep the card they had and add no Close control; sizes set the width", () => {
  const plain = renderToStaticMarkup(<Dialog title="T" onClose={noop} />);
  assert.doesNotMatch(plain, /sheet-close/);
  for (const [size, px] of [
    ["s", 360],
    ["m", 440],
    ["l", 720],
  ] as const)
    assert.match(
      renderToStaticMarkup(<Dialog title="T" size={size} onClose={noop} />),
      new RegExp(`max-width:${px}px`),
      size,
    );
});

test("a note sits above the actions", () => {
  const html = renderToStaticMarkup(
    <Dialog
      title="T"
      note="This does not delete the files."
      actions={[{ label: "Go", primary: true, onPress: noop }]}
      onClose={noop}
    />,
  );
  assert.ok(html.includes("This does not delete the files."));
  assert.ok(html.indexOf("This does not delete the files.") < html.indexOf(">Go<"));
});
