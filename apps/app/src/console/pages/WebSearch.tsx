// Console, AI: the web search agents use for chrome_search. The key-less default, or Brave Search or Bing with the Space's own key, which stays in the Vault: this page keeps only the handle of the Vault item.
// The key picker shows only once a service is chosen. Saves as it is made (settings.set_space), the same as the other Space settings.
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { Group, Section } from "../shell/ui.tsx";
import { Note, ReadState, useAction, useRead } from "./shared.tsx";
import { Choice } from "./ai-controls.tsx";
import { VaultReference } from "./Connections.tsx";

type Setting = CapMap["settings.get"]["out"];
export const SEARCH_OPTIONS = [
  { key: "default", title: "Default (no key)" },
  { key: "brave", title: "Brave Search" },
  { key: "bing", title: "Bing" },
] as const;
export const SEARCH_NOTE =
  "Agents use this to look up the documentation of a site they work on. The default needs no key and can be refused; a service with its own key is steadier.";

export function WebSearchSetting(): ReactElement {
  const provider = useRead<Setting>("settings.get", { key: "search.provider" });
  const key = useRead<Setting>("settings.get", { key: "search.key" });
  const refresh = (): void => {
    provider.refresh();
    key.refresh();
  };
  const action = useAction(refresh);
  if (!provider.data || !key.data) return <ReadState error={provider.error ?? key.error} retry={refresh} />;
  const chosen = String(provider.data.row.value ?? "default");
  const handle = String(key.data.row.value ?? "");
  const service = chosen === "bing" ? "Bing" : "Brave Search";
  return (
    <Section title="Web search for agents">
      <Group>
        <Choice
          label="Search service"
          value={SEARCH_OPTIONS.some((o) => o.key === chosen) ? chosen : "default"}
          options={SEARCH_OPTIONS}
          disabled={action.busy}
          onChange={(value) =>
            void action.run("settings.set_space", { key: "search.provider", value }, "Search service changed")
          }
        />
        {chosen !== "default" ? (
          <VaultReference
            name={`${service} key`}
            description={`The Vault item that holds your ${service} API key.`}
            value={handle}
            onChange={(value) =>
              void action.run("settings.set_space", { key: "search.key", value }, "Search key chosen")
            }
          />
        ) : null}
        <Note>{SEARCH_NOTE}</Note>
        {action.note ? <Note>{action.note}</Note> : null}
      </Group>
    </Section>
  );
}
