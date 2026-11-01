// The names of a new record type: the plural of a singular, the singular of a plural, and a name that is already plural stays as typed.
import test from "node:test";
import assert from "node:assert/strict";
import { createTypeOps, isPlural, namesOf, pluralOf, singularOf } from "./model.ts";

test("a singular name gets its plural by the common English rules", () => {
  const cases: Array<[string, string]> = [["Deal", "Deals"], ["Company", "Companies"], ["Person", "People"], ["Matter", "Matters"], ["Status", "Statuses"], ["Box", "Boxes"], ["Address", "Addresses"], ["Match", "Matches"], ["Day", "Days"], ["Child", "Children"], ["Key contact", "Key contacts"], ["Staff", "Staff"], ["Law firm", "Law firms"], ["Bus", "Buses"], ["Case", "Cases"]];
  for (const [one, many] of cases) assert.equal(pluralOf(one), many, one);
  assert.equal(pluralOf(""), "");
});

test("a name that is already plural is not made plural again: Deals does not become Dealses", () => {
  for (const name of ["Deals", "Companies", "People", "Matters", "Statuses", "Boxes", "Clients", "Key contacts", "Children", "Cases"]) { assert.equal(isPlural(name), true, name); assert.equal(pluralOf(name), name, name); }
  for (const name of ["Deal", "Company", "Person", "Status", "Address", "Business", "Analysis", "Staff", "Class"]) assert.equal(isPlural(name), false, name);
});

test("the singular is inferred from a plural name", () => {
  const cases: Array<[string, string]> = [["Deals", "Deal"], ["Companies", "Company"], ["People", "Person"], ["Matters", "Matter"], ["Statuses", "Status"], ["Boxes", "Box"], ["Matches", "Match"], ["Cases", "Case"], ["Key contacts", "Key contact"], ["Children", "Child"], ["Campuses", "Campus"], ["Days", "Day"], ["Movies", "Movie"], ["Deal", "Deal"], ["Status", "Status"]];
  for (const [many, one] of cases) assert.equal(singularOf(many), one, many);
  assert.equal(singularOf("PEOPLE"), "PERSON");
});

test("whichever number is typed, the type gets a singular title and a plural, and the plural can still be set by hand", () => {
  assert.deepEqual(namesOf("Deals"), { title: "Deal", plural: "Deals" });
  assert.deepEqual(namesOf("Company"), { title: "Company", plural: "Companies" });
  assert.deepEqual(namesOf("People"), { title: "Person", plural: "People" });
  assert.deepEqual(namesOf("Status"), { title: "Status", plural: "Statuses" });
  assert.deepEqual(namesOf("Deal", "Agreements"), { title: "Deal", plural: "Agreements" });
});

test("a type made from a plural name has a singular title, a plural, and a key that is the singular", () => {
  for (const [typed, key, title, plural] of [["Deals", "deal", "Deal", "Deals"], ["Companies", "company", "Company", "Companies"], ["People", "person", "Person", "People"], ["Company", "company", "Company", "Companies"]] as const) {
    const made = createTypeOps({ name: typed, plural: "", icon: "table", takenKeys: [] });
    const op = made.ops[0] as { type: string; def: { title: string; plural: string } };
    assert.deepEqual([made.key, op.type, op.def.title, op.def.plural], [key, key, title, plural], typed);
  }
  assert.equal(createTypeOps({ name: "Deals", plural: "", icon: "table", takenKeys: ["deal"] }).key, "deal_2", "a key in use gets the next free one");
});
