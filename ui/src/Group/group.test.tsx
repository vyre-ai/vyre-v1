// ui/Group: a titled block whose rows get their hairlines from the Group itself (P3 contract: props title, count, action, hint, note, empty, children).
import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { Group } from "./index.tsx";

const html = (el: ReactElement): string => renderToStaticMarkup(el).replaceAll("<!-- -->", "");

test("a Group draws its title, count and action in the head, and one hairline between rows, none above the first or below the last", () => {
  const out = html(
    <Group title="AI accounts" count={3} action={<Text>Add</Text>}>
      <Text>one</Text>
      <Text>two</Text>
      <Text>three</Text>
    </Group>,
  );
  assert.match(out, /role="heading"[^>]*>AI accounts</);
  assert.ok(out.includes(">3<") && out.includes(">Add<"));
  assert.equal((out.match(/data-testid="group-line"/g) ?? []).length, 2, "two hairlines for three rows");
  assert.ok(out.indexOf(">one<") < out.indexOf('data-testid="group-line"'), "none above the first row");
});

test("a Group with no title has no head; a hint sits behind an Info (not a paragraph); a note is one quiet line under the rows", () => {
  const bare = html(
    <Group>
      <Text>only</Text>
    </Group>,
  );
  assert.ok(!bare.includes('role="heading"'));
  const hinted = html(
    <Group title="Your use" hint="Only your own turns count" note="Resets each month">
      <Text>row</Text>
    </Group>,
  );
  assert.match(hinted, /title="Only your own turns count"/);
  assert.ok(!/>Only your own turns count</.test(hinted), "the hint is not drawn as text");
  assert.ok(hinted.indexOf(">row<") < hinted.indexOf(">Resets each month<"), "the note is under the rows");
});

test("a Group with nothing in it draws its empty state with its one action, and no hairlines", () => {
  const out = html(
    <Group
      title="Permissions"
      empty={{ title: "Nothing goes without asking", action: { label: "Learn more", onPress: () => undefined } }}
    >
      {null}
    </Group>,
  );
  assert.ok(out.includes("Nothing goes without asking") && out.includes("Learn more"));
  assert.ok(!out.includes('data-testid="group-line"'));
});
