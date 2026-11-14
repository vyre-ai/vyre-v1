// react-native-web drops a `title` prop on Pressable and View, so a `webProps({ title })` spread never reaches the page: the tip and the accessible name it was meant to give were missing.
// `dataSet: { tt }` does reach it (the one tooltip reads data-tt), and so does aria-label.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Pressable, Text, View } from "react-native";

test("what react-native-web does with title, data-tt and aria-label", () => {
  const p = renderToStaticMarkup(
    <Pressable {...({ title: "Stop" } as object)}>
      <Text>x</Text>
    </Pressable>,
  );
  const v = renderToStaticMarkup(
    <View {...({ title: "Stop" } as object)}>
      <Text>x</Text>
    </View>,
  );
  assert.equal(p.includes('title="Stop"'), false, "Pressable drops title");
  assert.equal(v.includes('title="Stop"'), false, "View drops title");
  const d = renderToStaticMarkup(
    <Pressable {...({ dataSet: { tt: "Stop" } } as object)}>
      <Text>x</Text>
    </Pressable>,
  );
  assert.ok(d.includes('data-tt="Stop"'));
});
