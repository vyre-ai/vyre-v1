import test from "node:test";
import assert from "node:assert/strict";
import { railPlaceOf, routeIdOf } from "./PlaceHost.tsx";

test("places: every rail place that has a screen maps to its route id and back; Console has its standalone route; join is anonymous", () => {
  const pairs: [string, string][] = [["home", "home"], ["chats", "chat"], ["inbox", "mail"], ["records", "records"], ["files", "files"], ["apps", "sites"], ["automations", "automations"], ["vault", "vault"], ["settings", "settings"]];
  for (const [rail, route] of pairs) {
    assert.equal(routeIdOf(rail as never), route);
    assert.equal(railPlaceOf(route), rail);
  }
  assert.equal(routeIdOf("console"), "console");
  assert.equal(routeIdOf("join"), null);
  assert.equal(railPlaceOf("nowhere"), null);
});
