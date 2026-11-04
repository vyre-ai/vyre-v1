// The hooks section of a helper (lane l-hooks): the hooks its lead gave it say "From <lead>", the ones it carries from the run and the Space say "Inherited"; no section where it has none.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { HelperChat } from "./HelperChat.tsx";
import { splitHooks } from "./HelperHooks.tsx";
import { createSample } from "./sample.ts";
import type { Sample } from "./sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample): string => clean(renderToStaticMarkup(<HelperChat data={s.data} />));

test("a helper with hooks shows them: its own first, then the inherited, each tagged", () => {
  const out = html(createSample("done", { hooks: true }));
  assert.ok(out.includes('data-testid="helper-hooks"') && /Hooks for /.test(out));
  const own = out.indexOf('data-testid="helper-hook-hok_own"'), run = out.indexOf('data-testid="helper-hook-hok_run"'), space = out.indexOf('data-testid="helper-hook-hok_space"');
  assert.ok(own >= 0 && own < run && run < space);
  assert.ok(out.includes("From Intake") || /From [A-Z]/.test(out), "the lead's own say From <lead>");
  assert.equal((out.match(/Inherited/g) ?? []).length >= 2, true);
});

test("no hooks, no section", () => {
  assert.ok(!html(createSample("done")).includes('data-testid="helper-hooks"'));
});

test("splitHooks puts a run hook set on the helper's own thread apart from the rest", () => {
  const h = (id: string, scope: string, threadId?: string) => ({ id, scope, threadId }) as never;
  const r = splitHooks([h("a", "run", "H"), h("b", "run", "P"), h("c", "space"), h("d", "chat", "P")], "H");
  assert.deepEqual([r.own.map((x) => x.id), r.chat.map((x) => x.id), r.inherited.map((x) => x.id)], [["a"], ["d"], ["b", "c"]], "the chat's own rule is shown as From this chat, apart from the rest");
});
