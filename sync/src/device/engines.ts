// Which storage engine a device uses, from the spike outcomes recorded in spikes/REPORT.md (S5 web, S12 shells) and ARCH 5.10.
import type { DeviceClass } from "../protocol.ts";

export type DeviceTarget = "ios" | "android" | "web" | "desktop-mac" | "desktop-windows" | "desktop-linux";
export type EngineId = "sqlcipher-expo" | "sqlite3mc-opfs" | "wa-sqlite-aes" | "sidecar-node-aes";
export type ProbeResult = "pass" | "fail" | "unknown";

/** What the spikes measured. A target whose probe is not "pass" falls to the recorded fallback. */
export interface SpikeOutcome {
  /** S5: sqlite-wasm-cipher 2.2.4 (chacha20) on OPFS, 200k rows, headless Chrome. Run 40109672513. */
  webCipherOpfs: ProbeResult;
  /** S12: Tauri 2 shell loads the web build and the encrypted OPFS replica persists across restart. Runs 40117021667 (mac), 40117021598 (windows). */
  shell: { mac: ProbeResult; windows: ProbeResult; linux: ProbeResult };
}

/** REPORT.md as recorded. Linux (WebKitGTK) was not run: best effort, so it takes the sidecar fallback. */
export const RECORDED_OUTCOME: SpikeOutcome = {
  webCipherOpfs: "pass",
  shell: { mac: "pass", windows: "pass", linux: "unknown" },
};

export interface EngineChoice {
  engine: EngineId;
  /** True when the primary engine for this target did not pass its spike. */
  fallback: boolean;
  /** One line a log or the doctor page can show. */
  reason: string;
}

export function deviceClassOf(target: DeviceTarget): DeviceClass {
  if (target === "ios" || target === "android") return "phone";
  if (target === "web") return "web";
  return "desktop";
}

export function selectEngine(target: DeviceTarget, outcome: SpikeOutcome = RECORDED_OUTCOME): EngineChoice {
  if (target === "ios" || target === "android") {
    return { engine: "sqlcipher-expo", fallback: false, reason: "expo-sqlite with SQLCipher; replicaKey wrapped in IndexedDB-equivalent store, no keychain required" };
  }
  if (target === "web") {
    return outcome.webCipherOpfs === "pass"
      ? { engine: "sqlite3mc-opfs", fallback: false, reason: "S5 passed: sqlite3mc on OPFS rejects no key and a wrong key" }
      : { engine: "wa-sqlite-aes", fallback: true, reason: `S5 web cipher OPFS is ${outcome.webCipherOpfs}: wa-sqlite 1.0.0 with app-layer AES-GCM` };
  }
  const shell = target === "desktop-mac" ? outcome.shell.mac : target === "desktop-windows" ? outcome.shell.windows : outcome.shell.linux;
  if (shell === "pass" && outcome.webCipherOpfs === "pass") {
    return { engine: "sqlite3mc-opfs", fallback: false, reason: "S12 passed: the shell runs the web replica in the system webview" };
  }
  return { engine: "sidecar-node-aes", fallback: true, reason: `S12 shell result is ${shell}: the UI talks to the vyred device sidecar (node:sqlite, app-layer AES-GCM)` };
}
