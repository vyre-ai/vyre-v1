import test from "node:test";
import assert from "node:assert/strict";
import { checkNoContentInLogs } from "./no-content-in-logs.ts";
import { checkListSections } from "./list-sections.ts";
import { checkNoEmDashOrSectionSign } from "./no-em-dash-or-section-sign.ts";

const logFile = "modules/mail/handlers/send.ts";
const filesSidebar = "apps/app/src/places/files/Sidebar.tsx";
const settingsSidebar = "apps/app/src/places/settings/Sidebar.tsx";

test("no-content-in-logs rejects content-bearing attrs", () => {
  const bad = `logger.info("mail.sent", { traceId: id, subject: mail.subject, body: mail.body });\n`;
  const attrs = `log.write({ msg: "record.updated", attrs: { text: record.text, secret: token, id } });\n`;
  const value = `logger.info("record.updated", { value: field.value, entityId: id });\n`;
  const keys = new Set<string>();
  for (const source of [bad, attrs, value]) {
    const hits = checkNoContentInLogs(logFile, source);
    assert.ok(hits.length >= 1);
    for (const hit of hits) {
      assert.equal(hit.rule, "no-content-in-logs");
      const name = /"([^"]+)"/.exec(hit.message)?.[1];
      if (name) keys.add(name);
    }
  }
  for (const name of ["body", "text", "subject", "value", "secret"]) assert.ok(keys.has(name), name);
  const ok = `logger.info("mail.sent", { traceId: id, entityId: mailId, count: 1 });\n`;
  const counts = `log.write({ msg: "record.updated", attrs: { entity_id: id, label: 0, tokens_out: 12 } });\n`;
  assert.equal(checkNoContentInLogs(logFile, ok).length, 0);
  assert.equal(checkNoContentInLogs(logFile, counts).length, 0);
});

test("list-sections requires ListSections for a listed sidebar", () => {
  const raw = `export function FilesSidebar({ files }: { files: { id: string; name: string }[] }) {\n  return files.map((file) => <Row key={file.id}>{file.name}</Row>);\n}\n`;
  const hits = checkListSections(filesSidebar, raw);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "list-sections");
  assert.match(hits[0].message, /ListSections/);
  assert.match(hits[0].message, /files/);
  const used = `import { ListSections } from "ui/ListSections";\nexport function FilesSidebar({ files }: { files: { id: string; name: string }[] }) {\n  return <ListSections type="files" items={files} />;\n}\n`;
  assert.equal(checkListSections(filesSidebar, used).length, 0);
  const settings = `export function SettingsSidebar({ rows }: { rows: { id: string }[] }) {\n  return rows.map((row) => <Row key={row.id} />);\n}\n`;
  assert.equal(checkListSections(settingsSidebar, settings).length, 0);
});

test("no-em-dash-or-section-sign flags the em dash and the section sign", () => {
  const dash = "Hover the row " + "\u2014" + " then click.\n";
  const sign = "Read " + "\u00A7" + " 4 before editing.\n";
  const escapedDash = "const label = \"see \\u2014 here\";\n";
  const escapedSign = "const label = \"see \\u00A7 here\";\n";
  const plain = "Hover the row - then click. Read section 4.\n";
  const en = "Range " + "\u2013" + " done.\n";
  for (const source of [dash, escapedDash]) {
    const hits = checkNoEmDashOrSectionSign("docs/copy.md", source);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].rule, "no-em-dash-or-section-sign");
    assert.equal(hits[0].message, "em dash is not allowed");
  }
  for (const source of [sign, escapedSign]) {
    const hits = checkNoEmDashOrSectionSign("docs/copy.md", source);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].message, "section sign is not allowed");
  }
  assert.equal(checkNoEmDashOrSectionSign("docs/copy.md", plain).length, 0);
  assert.equal(checkNoEmDashOrSectionSign("docs/copy.md", en).length, 0);
});
