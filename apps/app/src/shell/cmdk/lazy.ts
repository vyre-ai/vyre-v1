// The search of a "+" tab before the Space has answered. The new tab used to draw a dead "Open anything, or start something" for as long as the Space was connecting, and a press of "+" on a slow link looked
// swallowed. This stands in for the real search (gate.ts) until it exists: the field is there from the first press and typing works; results and a started chat arrive when the Space answers, by themselves.
import type { CmdKData } from "./controller.ts";
import { firstWords } from "../../places/chats/landing/pending.ts";

export interface LazyOptions {
  /** How often to look for the real search (ms). */
  pollMs?: number;
  /** How long a started chat waits for the Space before it fails (ms): it ends in the failed state with Retry, never in silence. */
  giveUpMs?: number;
}

export function lazySearch(get: () => CmdKData | null, o: LazyOptions = {}): CmdKData {
  const pollMs = o.pollMs ?? 100;
  const giveUpMs = o.giveUpMs ?? 60_000;
  const ready = (): Promise<CmdKData> =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const look = (): void => {
        const d = get();
        if (d !== null) resolve(d);
        else if (Date.now() - t0 > giveUpMs) reject(new Error("The Space did not answer."));
        else setTimeout(look, pollMs);
      };
      look();
    });
  return {
    scope: () => get()?.scope() ?? "space",
    online: () => get()?.online() ?? true,
    spaceName: () => get()?.spaceName?.() ?? "",
    local: (text, types) => get()?.local(text, types) ?? [],
    server: async (text, types) => (await ready()).server(text, types),
    recent: () => get()?.recent() ?? [],
    actions: (text) => get()?.actions(text) ?? [],
    skins: () => get()?.skins() ?? [],
    currentSkin: () => get()?.currentSkin() ?? "system",
    previewSkin: (id) => get()?.previewSkin(id),
    setSkin: (id) => get()?.setSkin(id),
    open: (hit, opts) => get()?.open(hit, opts),
    copyLink: (hit) => get()?.copyLink(hit),
    runAction: (a) => get()?.runAction(a),
    recordOpened: (hit) => get()?.recordOpened(hit),
    ask: async (q) => {
      const d = await ready();
      if (!d.ask) throw new Error("no ask");
      return d.ask(q);
    },
    continueInChat: (c) => {
      void ready().then((d) => d.continueInChat?.(c));
    },
    copyText: (t) => get()?.copyText?.(t),
    newKey: () => get()?.newKey?.() ?? `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    // his words and the tab's name are on screen at once (the controller draws them from this synchronous answer); the chat is made when the Space is there
    startChat: (chat) => {
      const title = chat.title ?? firstWords(chat.text);
      const sent = ready().then((d) => {
        if (!d.startChat) throw new Error("no start");
        return d.startChat({ ...chat, title }).sent;
      });
      return { title, sent };
    },
    warm: () => {
      void ready().then(
        (d) => d.warm?.(),
        () => undefined,
      );
    },
    openLink: (text) => get()?.openLink?.(text) ?? false,
  };
}
