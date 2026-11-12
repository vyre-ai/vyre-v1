// The desktop shell's banner and badge (apps/desktop/src-tauri/src/native.rs: `notify`, `set_badge`), as the signed-in app reaches them. Null in a browser, where there is no shell.
// A banner the operating system would not show (notifications for Vyre turned off in the system settings, where the shell can tell) is remembered, so Settings, Notifications can say so once,
// quietly; the app never asks again or nags. On macOS the system itself asks the first time a banner is shown; the desktop notification plugin cannot read a refusal there (it answers "granted"),
// so a refusal on a Mac shows as banners that do not appear, which only the system settings can change.
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface OsShell {
  notify(b: { title: string; body: string; link: string }): void;
  badge(count: number): void;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let refused = false;
/** The shell said a banner could not be shown (the system refused it). Read by Settings, Notifications. */
export const bannersRefused = {
  get: (): boolean => refused,
  set(v: boolean): void {
    if (v === refused) return;
    refused = v;
    for (const l of [...listeners]) l();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** How the notification plugin words a refusal by the system (permission denied, not allowed, disabled). */
const REFUSED = /denied|not allowed|not permitted|disabled|permission/i;

export function osShell(g: unknown = globalThis): OsShell | null {
  const invoke = (g as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") return null;
  let last = -1;
  return {
    notify(b) {
      // only the system refusing banners says they are off; any other error (a bad link, a plugin hiccup) is not a refusal
      void Promise.resolve(invoke("notify", { title: b.title, body: b.body, link: b.link })).then(
        () => bannersRefused.set(false),
        (e: unknown) => {
          if (REFUSED.test(String((e as { message?: unknown })?.message ?? e))) bannersRefused.set(true);
        },
      );
    },
    badge(count) {
      const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
      if (n === last) return;
      last = n;
      void Promise.resolve(invoke("set_badge", { count: n })).catch(() => undefined);
    },
  };
}
