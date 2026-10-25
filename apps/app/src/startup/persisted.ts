// Persisted UI state: one synchronous read at startup. localStorage on web; memory elsewhere until the native store lands.
import type { UiState, UiStateStore } from "./startup.ts";

const KEY = "vyre.ui.v1";
const EMPTY: UiState = { lastPlace: null, railOrder: [] };

export function webUiStateStore(storage: Pick<Storage, "getItem" | "setItem"> | undefined = (globalThis as { localStorage?: Storage }).localStorage): UiStateStore {
  let memory: UiState = { ...EMPTY };
  return {
    read() {
      try {
        const raw = storage?.getItem(KEY);
        if (raw) memory = { ...EMPTY, ...(JSON.parse(raw) as Partial<UiState>) };
      } catch {
        // storage blocked or corrupt: start from defaults
      }
      return memory;
    },
    write(patch) {
      memory = { ...memory, ...patch };
      try { storage?.setItem(KEY, JSON.stringify(memory)); } catch { /* blocked storage: memory only */ }
    },
  };
}
