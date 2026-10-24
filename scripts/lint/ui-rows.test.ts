import test from "node:test";
import assert from "node:assert/strict";
import { checkUiRows } from "./ui-rows.ts";
import { BUDGET_MS, lintChanged, rules } from "./run.ts";

const row = "apps/app/src/places/files/List.tsx";

const fullWidth = `
import { Row } from "ui/Row";
export function FileList({ items, selected }: { items: { id: string; title: string; note: string }[]; selected: string }) {
  return items.map((item) => (
    <Row
      key={item.id}
      style={{ width: "100%", backgroundColor: item.id === selected ? "#eef" : "transparent" }}
    >
      <Text>{item.title}</Text>
      <Text>{item.note}</Text>
    </Row>
  ));
}
`;

test("ui-rows lint: every list item is a ui/Row", () => {
  const bad = `
    export function FileList({ items }: { items: { id: string; name: string }[] }) {
      return items.map((item) => (
        <View key={item.id}>{item.name}</View>
      ));
    }
  `;
  const hits = checkUiRows(row, bad);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "ui-rows");
  assert.equal(hits[0].message, "every list item is a ui/Row");
  assert.equal(checkUiRows(row, fullWidth).length, 0);
});

test("ui-rows lint: hover and selection are full width", () => {
  const inset = `
    export function FileList({ items, hovered }: { items: { id: string; name: string }[]; hovered: string }) {
      return items.map((item) => (
        <Row key={item.id} style={{ width: "100%" }}>
          <View style={{ marginHorizontal: 12, backgroundColor: item.id === hovered ? "#eef" : "transparent" }}>
            {item.name}
          </View>
        </Row>
      ));
    }
  `;
  const narrow = `
    const selected = true;
    export function FileList({ items }: { items: { id: string; name: string }[] }) {
      return items.map((item) => (
        <Row style={{ width: 280, backgroundColor: selected ? "#eef" : "#fff" }}>{item.name}</Row>
      ));
    }
  `;
  for (const source of [inset, narrow]) {
    const hits = checkUiRows(row, source);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].message, "hover and selection must be full width");
  }
  const virtual = `
    <VirtualList data={items} renderItem={(item) => (
      <Row style={{ width: "100%", backgroundColor: item.selected ? "#eef" : "transparent" }}>{item.name}</Row>
    )} />
  `;
  assert.equal(checkUiRows(row, virtual).length, 0);
});

test("lint checks changed files only and finishes within 10 s", () => {
  assert.deepEqual(rules.map((rule) => rule.id), [
    "ui-rows",
    "menu-icons",
    "no-raw-context-menu",
    "list-sections",
    "no-content-in-logs",
    "no-em-dash-or-section-sign",
  ]);
  const bad = `export const view = items.map((item) => <View>{item.name}</View>);\n`;
  const files = [];
  for (let i = 0; i < 200; i++) files.push({ file: `apps/app/src/row-${i}.tsx`, source: bad });
  const t0 = Date.now();
  const hits = lintChanged(files, ["apps/app/src/row-0.tsx"]);
  assert.ok(Date.now() - t0 < BUDGET_MS);
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((hit) => hit.file === "apps/app/src/row-0.tsx"));
  assert.equal(hits[0].rule, "ui-rows");
});
