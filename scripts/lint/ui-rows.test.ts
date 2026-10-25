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

// ---- P-CI_26: only callbacks that return JSX are list rendering ----------------------------------------------------------------------

const hitsOf = (source: string) => checkUiRows(row, source);

test("ui-rows lint: a data map passes however much JSX sits nearby, including JSX within 800 characters after it", () => {
  const dataMaps = [
    `const ids = items.map((item) => item.id);\nexport const view = <View><Text>{ids.length}</Text></View>;`,
    `const names = items.map((item) => item.name.toUpperCase()).filter(Boolean);\nexport function X() { return <View><Text>{names.join(", ")}</Text></View>; }`,
    `const byId = items.map((item) => ({ id: item.id, label: item.title }));\nexport const header = <Header title="Files" />;`,
    `const total = rows.map((r) => { const n = r.size * 2; return n; });\nexport const view = <Row>{total.length}</Row>;`,
    `const lines = text.split("\\n").map(function (l) { return l.trim(); });\nexport const view = <Text>{lines[0]}</Text>;`,
    `const keys = Object.keys(o).map(String);\nconst Later = () => <View />;`,
    `const parsed = values.map((v) => v < 3 ? "low" : "high");\nexport const view = <View>{parsed}</View>;`,
    `const cmp = list.map((a) => a.x > 1 && a.y < 2);\nexport const view = <View />;`,
  ];
  for (const source of dataMaps) assert.deepEqual(hitsOf(source), [], source);
});

test("ui-rows lint: a callback that returns JSX is checked, in every shape it can be written", () => {
  const notRows = [
    `export const a = items.map((item) => <View key={item.id}>{item.name}</View>);`,
    `export const b = items.map((item) => (\n  <View key={item.id}>{item.name}</View>\n));`,
    `export const c = items.map((item) => {\n  const label = item.name;\n  return <View key={item.id}>{label}</View>;\n});`,
    `export const d = items.map((item) => {\n  return (\n    <View key={item.id}>{item.name}</View>\n  );\n});`,
    `export const e = items.map(function (item) { return <View key={item.id}>{item.name}</View>; });`,
    `export const f = <VirtualList data={items} renderItem={(item) => <View>{item.name}</View>} />;`,
    `const renderItem = (item: Item) => <View>{item.name}</View>;`,
    `export const g = items.map((item, i) => <Fragment.Item key={i} />);`,
  ];
  for (const source of notRows) {
    const hits = hitsOf(source);
    assert.equal(hits.length, 1, source);
    assert.equal(hits[0]!.message, "every list item is a ui/Row", source);
  }
  const rows = [
    `export const a = items.map((item) => <Row key={item.id} title={item.name} />);`,
    `export const b = items.map((item) => {\n  return <Row key={item.id} title={item.name} />;\n});`,
    `export const c = items.map((item) => <ui.Row key={item.id} title={item.name} />);`,
    `export const d = items.map(function (item) { return <Row key={item.id} title={item.name} />; });`,
  ];
  for (const source of rows) assert.deepEqual(hitsOf(source), [], source);
});

test("ui-rows lint: returns inside a nested function or a string belong to someone else; the first top-level JSX return decides; hover rules still apply to Row callbacks", () => {
  // the inner function returns JSX but the map's own callback returns a string
  assert.deepEqual(hitsOf(`const labels = items.map((item) => {\n  const make = () => { return <View />; };\n  return String(item.id) + make.name;\n});`), []);
  // a string that contains the word return and a tag
  assert.deepEqual(hitsOf('const notes = items.map((item) => { const s = "return <View />"; return s + item.id; });'), []);
  // a comment that contains return <View
  assert.deepEqual(hitsOf(`const ids = items.map((item) => {\n  // return <View /> would be a list\n  return item.id;\n});`), []);
  // an early return of null, then a JSX return: the JSX return decides
  assert.equal(hitsOf(`const v = items.map((item) => {\n  if (!item) return null;\n  return <View key={item.id} />;\n});`).length, 1, "the early null return is skipped; the JSX return after it is the list item");
  assert.equal(hitsOf(`const v = items.map((item) => {\n  const x = 1;\n  return <View key={item.id}>{x}</View>;\n});`).length, 1);
  // a Row callback is still held to full-width hover and selection
  const narrow = `const v = items.map((item) => {\n  return <Row style={{ width: 280, backgroundColor: item.selected ? "#eef" : "#fff" }}>{item.name}</Row>;\n});`;
  const hits = hitsOf(narrow);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.message, "hover and selection must be full width");
});

test("ui-rows lint: the rest of the file is not read as the callback: a map by reference and a map followed by an unrelated arrow function pass", () => {
  assert.deepEqual(hitsOf(`const a = items.map(render);\nconst Later = () => <View />;`), []);
  assert.deepEqual(hitsOf(`const a = items.map(toRow);\nexport const b = () => (\n  <View />\n);`), []);
  assert.deepEqual(hitsOf(`const a = items.map(Number); const b = (x: number) => <View>{x}</View>;`), []);
});
