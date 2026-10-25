// ui/Recipients: address chips, the picker, paste, Cc and Bcc on demand, token menu, Reply All (spec 2.18).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { menuEntries } from "../Menu/index.tsx";
import { isItem, isReportItem, isSeparator } from "../Menu/props.ts";
import {
  Recipients,
  addToken,
  addresses,
  emptyRows,
  expandGroup,
  isBad,
  isExternal,
  isValidAddress,
  moveToken,
  parseAddresses,
  removeToken,
  replyAll,
  replyAllRows,
  rowsFrom,
  splitTyped,
  suggest,
  suggestionToken,
  summary,
  toToken,
} from "./index.tsx";
import type { DirectoryEntry, RecipientGroup, Rows } from "./index.tsx";

const directory: DirectoryEntry[] = [
  { name: "Elena Rivera", email: "elena@riveraholdings.example", kind: "record", sub: "Client, Rivera Holdings", rec: "Rivera matter" },
  { name: "Marcus Lee", email: "marcus@riveraholdings.example", kind: "record", sub: "Contact, Rivera Holdings" },
  { name: "Maya Chen", email: "maya@northwind.example", kind: "team", sub: "Team member" },
  { name: "Omar Haddad", email: "omar@northwind.example", kind: "team", sub: "Team member" },
  { name: "Billing", email: "billing@northwind.example", kind: "agent", sub: "Agent inbox" },
];
const groups: RecipientGroup[] = [{ name: "Delivery", members: ["maya@northwind.example", "omar@northwind.example"] }];
const ME = "irfad@northwind.example";

test("the rendered field shows To with its placeholder and the Cc and Bcc buttons; Cc and Bcc rows stay hidden when empty", () => {
  const html = renderToStaticMarkup(<Recipients me={ME} directory={directory} />);
  assert.match(html, /data-testid="recipients-row-to"/);
  assert.match(html, /placeholder="Add people, groups or addresses"/);
  assert.match(html, /data-testid="recipients-add-cc"/);
  assert.match(html, /data-testid="recipients-add-bcc"/);
  assert.doesNotMatch(html, /recipients-row-cc/);
  assert.doesNotMatch(html, /recipients-row-bcc/);
});

test("a row with addresses shows chips; Cc appears when it has people, and its button goes away", () => {
  const html = renderToStaticMarkup(<Recipients me={ME} directory={directory} to={["elena@riveraholdings.example"]} cc={[{ email: "maya@northwind.example", name: "Maya Chen" }]} />);
  assert.match(html, /data-testid="recipient-to-0"/);
  assert.match(html, /Elena Rivera/);
  assert.match(html, /recipients-row-cc/);
  assert.match(html, /Maya Chen/);
  assert.doesNotMatch(html, /recipients-add-cc/);
  assert.match(html, /recipients-add-bcc/);
});

test("an external address carries a dot, a typo is marked, an internal address has neither", () => {
  const ext = toToken("elena@riveraholdings.example", directory);
  const int = toToken("maya@northwind.example", directory);
  const typo = toToken("maya@northwind", directory);
  assert.equal(isExternal(ext, ["northwind.example"]), true);
  assert.equal(isExternal(int, ["northwind.example"]), false);
  assert.equal(isBad(typo), true);
  assert.equal(isBad(ext), false);
  const html = renderToStaticMarkup(<Recipients me={ME} directory={directory} internal={["northwind.example"]} to={["elena@riveraholdings.example", "maya@northwind.example", "maya@northwind"]} />);
  assert.equal(html.match(/data-testid="recipient-external"/g)?.length, 1);
  assert.match(html, /data-bad="true"/);
});

test("address validation", () => {
  assert.equal(isValidAddress("a@b.co"), true);
  assert.equal(isValidAddress(" a@b.co "), true);
  assert.equal(isValidAddress("a@b"), false);
  assert.equal(isValidAddress("a b@c.com"), false);
});

test("parseAddresses reads bare addresses and Name <address>, split on commas, semicolons, spaces and lines", () => {
  assert.deepEqual(parseAddresses("a@x.com, b@y.com; c@z.com\nd@w.com"), [{ email: "a@x.com" }, { email: "b@y.com" }, { email: "c@z.com" }, { email: "d@w.com" }]);
  assert.deepEqual(parseAddresses('Elena Rivera <elena@r.example>, "Lee Marcus" <marcus@r.example>'), [{ email: "elena@r.example", name: "Elena Rivera" }, { email: "marcus@r.example", name: "Lee Marcus" }]);
});

test("paste: a list of addresses becomes chips, a half-typed one stays in the field", () => {
  assert.deepEqual(splitTyped("a@x.com, b@y.com"), { done: [{ email: "a@x.com" }, { email: "b@y.com" }], rest: "" });
  assert.deepEqual(splitTyped("a@x.com, b@y"), { done: [{ email: "a@x.com" }], rest: " b@y" });
  assert.deepEqual(splitTyped("a@x.com b@y.com"), { done: [{ email: "a@x.com" }, { email: "b@y.com" }], rest: "" });
  assert.deepEqual(splitTyped("a@x.com "), { done: [{ email: "a@x.com" }], rest: "" }, "a space after a finished address commits it");
  assert.deepEqual(splitTyped("eler"), { done: [], rest: "eler" });
  assert.deepEqual(splitTyped("Elena Rivera"), { done: [], rest: "Elena Rivera" }, "a name with a space is not split into addresses");
});

test("the picker ranks name start, then word start, then address, teammates and records first, and never offers an address already added or yours", () => {
  const rows = rowsFrom({ to: ["maya@northwind.example"] }, directory);
  const q = suggest("ma", directory, groups, rows, ME).map((s) => s.title);
  assert.deepEqual(q, ["Marcus Lee", "Omar Haddad"], "Maya is already in To, so she is not offered");
  const names = suggest("o", directory, groups, emptyRows(), ME).map((s) => s.title);
  assert.equal(names[0], "Omar Haddad");
  assert.deepEqual(suggest("irfad", [...directory, { name: "Irfad", email: ME, kind: "team" }], [], emptyRows(), ME), [], "your own address is never offered");
  assert.deepEqual(suggest("", directory, groups, emptyRows(), ME), []);
});

test("the picker lists a group with its members, and a typed valid address as Add this address", () => {
  const g = suggest("deliv", directory, groups, emptyRows(), ME)[0];
  assert.ok(g?.group);
  assert.equal(g.kindLabel, "2 people");
  assert.equal(g.note, "Maya, Omar");
  const typed = suggest("jules@archerlaw.example", directory, groups, emptyRows(), ME);
  assert.equal(typed[typed.length - 1]?.note, "Add this address");
  assert.equal(suggestionToken(typed[typed.length - 1] as never, directory).kind, "plain");
  const token = suggestionToken(g, directory);
  assert.equal(token.kind, "group");
  assert.deepEqual(addresses(addToken(emptyRows(), "to", token)).to, ["maya@northwind.example", "omar@northwind.example"]);
});

test("an address lives in one row: adding it again moves it", () => {
  let rows: Rows = addToken(emptyRows(), "to", toToken("maya@northwind.example", directory));
  rows = addToken(rows, "cc", toToken("MAYA@northwind.example", directory));
  assert.deepEqual(addresses(rows), { to: [], cc: ["maya@northwind.example"], bcc: [] });
});

test("move, remove and expand a group", () => {
  let rows = addToken(emptyRows(), "to", toToken("maya@northwind.example", directory));
  rows = addToken(rows, "to", toToken("omar@northwind.example", directory));
  rows = moveToken(rows, "to", 0, "bcc");
  assert.deepEqual(addresses(rows), { to: ["omar@northwind.example"], cc: [], bcc: ["maya@northwind.example"] });
  rows = removeToken(rows, "to", 0);
  assert.deepEqual(addresses(rows).to, []);
  const g = suggestionToken(suggest("delivery", directory, groups, emptyRows(), ME)[0] as never, directory);
  const grouped = addToken(emptyRows(), "to", g);
  const expanded = expandGroup(grouped, "to", 0, directory);
  assert.deepEqual(expanded.to.map((t) => t.name), ["Maya Chen", "Omar Haddad"]);
  assert.ok(expanded.to.every((t) => t.g === "Delivery"));
});

test("a long row collapses to a summary", () => {
  const rows = rowsFrom({ to: ["maya@northwind.example", "omar@northwind.example", "billing@northwind.example", "elena@riveraholdings.example"] }, directory);
  assert.equal(summary(rows.to.slice(0, 2)), "Maya Chen and Omar Haddad");
  assert.equal(summary(rows.to), "Maya Chen, Omar Haddad and 2 more");
  const html = renderToStaticMarkup(<Recipients me={ME} directory={directory} to={rows.to.map((t) => t.email)} />);
  assert.match(html, /Maya Chen, Omar Haddad and 2 more/);
});

test("Reply All never includes you and never repeats an address; Cc stays Cc", () => {
  const r = replyAll({ from: "elena@riveraholdings.example", to: [ME, "maya@northwind.example", "ELENA@riveraholdings.example"], cc: ["omar@northwind.example", "maya@northwind.example"] }, ME);
  assert.deepEqual(r, { to: ["elena@riveraholdings.example", "maya@northwind.example"], cc: ["omar@northwind.example"] });
  assert.deepEqual(replyAllRows({ from: { email: "elena@riveraholdings.example", name: "Elena" }, to: [ME] }, ME), { to: ["elena@riveraholdings.example"], cc: [] });
});

test("the token menu is made of ui/Menu: it ends with Report a problem", () => {
  const entries = menuEntries({ items: [{ label: "Move to Cc", icon: "open" }, { label: "Move to Bcc", icon: "open" }, { separator: true }, { label: "Copy Address", icon: "copy" }, { label: "Remove", icon: "trash", danger: true }] });
  const last = entries[entries.length - 1];
  assert.ok(last && isReportItem(last));
  const before = entries[entries.length - 2];
  assert.ok(before && isSeparator(before));
  assert.equal(entries.filter(isItem).length, 5);
});
