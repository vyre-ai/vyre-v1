// Every sheet and popover closes on Escape the same way, through the one layer stack (ui/Overlay/escape.ts): the topmost closes, the one under it stays, and a press from inside a text field still reaches it.
import test from "node:test";
import assert from "node:assert/strict";
import { act, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, flush } from "../../../../ui/src/testing/dom.ts";
import { Sheet as MobileSheet } from "../mobile/sheets/Sheet.tsx";
import { Sheet as VaultSheet } from "../places/vault/layout/Sheet.tsx";
import { Popover } from "../places/chats/mounts/Layers.tsx";

type Ev = { key?: string; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void };
type Fn = (e: Ev) => void;
function browserDocument(): { press(key?: string): void; restore(): void } {
  const doc = (globalThis as { document: Record<string, unknown> }).document;
  const had = { add: Object.getOwnPropertyDescriptor(doc, "addEventListener"), remove: Object.getOwnPropertyDescriptor(doc, "removeEventListener") };
  const cap: Fn[] = [], bub: Fn[] = [];
  const list = (c?: boolean): Fn[] => (c ? cap : bub);
  doc["addEventListener"] = (_t: string, f: Fn, c?: boolean) => { list(c).push(f); };
  doc["removeEventListener"] = (_t: string, f: Fn, c?: boolean) => { const l = list(c); const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  return {
    press(key = "Escape") {
      let stopped = false;
      const e: Ev = { key, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
      for (const f of [...cap]) { if (stopped) break; f(e); }
      if (!stopped) for (const f of [...bub]) f(e);
    },
    restore() {
      if (had.add) Object.defineProperty(doc, "addEventListener", had.add); else delete doc["addEventListener"];
      if (had.remove) Object.defineProperty(doc, "removeEventListener", had.remove); else delete doc["removeEventListener"];
    },
  };
}

function Host({ log }: { log: string[] }): ReactElement {
  const [open, setOpen] = useState({ phone: true, vault: true, popover: true });
  const shut = (k: keyof typeof open): void => { log.push(k); setOpen((o) => ({ ...o, [k]: false })); };
  return (
    <>
      <MobileSheet open={open.phone} title="Phone" onClose={() => shut("phone")}>{null}</MobileSheet>
      {open.vault ? <VaultSheet title="Vault" onClose={() => shut("vault")}>{null}</VaultSheet> : null}
      {open.popover ? <Popover x={10} y={10} label="List" testID="terminal-list" onClose={() => shut("popover")}>{null}</Popover> : null}
    </>
  );
}

test("a phone sheet, a Vault sheet and a Chats popover each close on Escape, one layer per key, the newest first", async () => {
  const restoreDom = installDom();
  const keys = browserDocument();
  try {
    const log: string[] = [];
    await mount(createRoot, <Host log={log} />);
    await flush();
    // the effects register in render order: phone, vault, popover: so the popover is the top
    for (const want of ["popover", "vault", "phone"]) {
      await act(async () => { keys.press(); });
      await flush();
      assert.equal(log.at(-1), want, `Escape closes the newest open layer (${want}) and only it`);
    }
    assert.deepEqual(log, ["popover", "vault", "phone"]);
    await act(async () => { keys.press(); });
    assert.deepEqual(log, ["popover", "vault", "phone"], "nothing is open: Escape closes nothing");
  } finally { keys.restore(); restoreDom(); }
});
