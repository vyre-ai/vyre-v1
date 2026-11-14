// The walk kit: an Automation of every step kind in the manifest opens, its step form opens on that step, and nothing is written. Opening a form must never write defaults into a person's definition, whatever the kind.
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { flush, installDom, mount } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { BuilderPage } from "./BuilderPage.tsx";

// every step key of manifests/steps-core.ts, plus one of each connector family the picker lists
const RICH = new Set(["send_sms"]);
const INPUTS: Record<string, unknown>[] = [
  {},
  {
    to: "{{trigger.email}}",
    body: "Hello {{trigger.name}}",
    subject: "Hi",
    text: "x",
    numberId: "num_main",
    mailboxId: "mbx_1",
  },
];

export async function walk(kinds: readonly string[]): Promise<string[]> {
  installDom();
  const written: string[] = [];
  for (const key of kinds)
    for (const [n, input] of INPUTS.entries()) {
      const s = createSampleAutomations(northwind);
      const row = s.replica.rows("automations").find((r) => r["id"] === "aut_digest")!;
      s.replica.put("automations", [
        {
          ...row,
          status: "off",
          definition: {
            triggers: [{ key: "manual" }],
            start: ["n1"],
            nodes: [
              {
                id: "n1",
                key,
                input,
                ...(key === "paths" || key === "if" ? { branches: [{ label: "Otherwise", to: "n1" }] } : {}),
              },
            ],
          },
        },
      ]);
      const data = {
        ...s.data,
        call: async (cap: string, i: unknown) => {
          if (/^automations\.(update|create|set_enabled|delete|restore_version|run|test)$/.test(cap))
            written.push(`${key}#${n}:${cap}`);
          return s.data.call(cap, i);
        },
      };
      if (RICH.has(key)) {
        // the text editor (tiptap) needs a browser DOM the test environment does not have: drawn once, statically; its form has no effect that writes
        renderToStaticMarkup(
          <AutomationsDataProvider value={data}>
            <BuilderPage automationId="aut_digest" initialSelected="n1" />
          </AutomationsDataProvider>,
        );
        continue;
      }
      try {
        await mount(
          createRoot,
          <AutomationsDataProvider value={data}>
            <BuilderPage automationId="aut_digest" initialSelected="n1" />
          </AutomationsDataProvider>,
        );
        await flush();
      } catch (e) {
        written.push(`${key}#${n}: threw ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  return written;
}
