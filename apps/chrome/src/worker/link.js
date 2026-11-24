// @ts-check
// Vyre for Chrome connected straight to a Space, with no Vyre app on the computer. One wire, two transports: this gives the bridge and the agent channel a port that
// looks like the native messaging port and speaks over a WebSocket to the Space (`/chrome/v1/socket`, lib/chrome-socket.ts). Nothing above it changes.
//
// Signing in is the pairing stack: the extension makes a secret value, keeps it, and sends only its hash to the Space's own page (a tab it opens); the person is signed in there
// the way they always are and presses Connect; the page hands back a one-time pair code bound to that hash; the extension redeems it with the value it kept, gets a device
// session of its own, and keeps exactly that one secret per Space under one key with one shape. Someone who reads the code off a screen cannot redeem it.
//
// States of one link: none -> pending (a value is kept, a tab is open) -> linked (a session is kept) -> [socket: connecting -> open -> closed]. A refused or revoked session
// returns it to none and says so; a lost connection is retried after a pause; a second begin replaces the first pending one; nothing leaves a pending value behind past ten minutes.

const KEY = "vyreLinks";
const PENDING_KEY = "vyrePendingLink";
export const PENDING_MS = 10 * 60_000;
export const DEVICE_NAME = "Chrome on this computer";
const SOCKET_PATH = "/chrome/v1/socket";
const CLOSE_REPLACED = 4000;
const CLOSE_SIGNED_OUT = 4401;
const CLOSE_REVOKED = 4403;

/** @typedef {{ address: string, token: string, space: string, name: string }} Linked */

/** The one address form a link accepts: https, or this computer's own http for a Space under development. Returns the origin, or null. @param {unknown} v */
export function spaceOrigin(v) {
  if (typeof v !== "string") return null;
  let text = v.trim();
  if (!text || text.length > 300) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password || (!u.hostname.includes(".") && !local)) return null;
  return u.origin;
}

/** @param {number} n */
function randomValue(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** @param {string} v */
async function sha256Hex(v) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** @param {unknown} v @returns {v is Linked[]} */
const linksShape = (v) =>
  Array.isArray(v) &&
  v.length <= 20 &&
  v.every(
    (l) =>
      l &&
      typeof l.address === "string" &&
      typeof l.token === "string" &&
      l.token.length <= 400 &&
      typeof l.space === "string" &&
      typeof l.name === "string" &&
      Object.keys(l).length === 4,
  );

/**
 * @typedef {{ get(keys: string[]): Promise<Record<string, any>>, set(items: Record<string, any>): Promise<void>, remove(keys: string[]): Promise<void> }} Area
 * @param {{ local: Area, session?: Area }} storage
 * @param {{ fetch?: typeof fetch, WebSocket?: any, now?: () => number, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void, retryMs?: number, helloMs?: number }} [o]
 */
export function createLink(storage, o = {}) {
  const doFetch = o.fetch ?? ((/** @type {any} */ u, /** @type {any} */ init) => globalThis.fetch(u, init));
  const WS = o.WebSocket ?? globalThis.WebSocket;
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t));
  const retryMs = o.retryMs ?? 10_000;
  const pendingArea = storage.session ?? storage.local;
  /** @type {Set<(e: { address: string, why: "signed_out" | "revoked" | "linked" }) => void>} */
  const watchers = new Set();
  /** @type {string} */
  let lastError = "";

  /** Sockets open now, by Space address: signing out closes them so nothing keeps talking on a session that was given up. @type {Set<{ address: string, close(): void }>} */
  const open = new Set();
  /** @type {Linked[]} what is kept, for the callers that cannot wait (a port opens at once) */
  let cache = [];

  /** @returns {Promise<Linked[]>} */
  async function links() {
    const raw = await storage.local.get([KEY]);
    cache = linksShape(raw[KEY]) ? raw[KEY] : [];
    return cache;
  }
  /** @param {Linked[]} list */
  const keep = async (list) => {
    cache = list;
    await storage.local.set({ [KEY]: list });
  };

  /** @param {string} address @param {"signed_out" | "revoked"} why */
  async function forget(address, why) {
    await keep((await links()).filter((l) => l.address !== address));
    for (const w of watchers) w({ address, why });
  }

  return {
    /** The Spaces this Chrome is connected to directly. */
    links,
    /** Read what is kept again (at start, and when another part of the extension changed it). */
    refresh: links,
    /** The Space to talk to directly now, from memory: null when this Chrome is not connected to one. @returns {Linked | null} */
    current: () => cache[0] ?? null,
    get lastError() {
      return lastError;
    },
    /** @param {(e: { address: string, why: "signed_out" | "revoked" | "linked" }) => void} f @returns {() => void} */
    onChange(f) {
      watchers.add(f);
      return () => watchers.delete(f);
    },

    /**
     * Start connecting: keep a fresh secret value, return the address of the Space's own page to open with only the value's hash in it. A new begin replaces an unfinished one.
     * @param {string} address
     * @returns {Promise<{ url: string, origin: string } | { error: "address" }>}
     */
    async begin(address) {
      const origin = spaceOrigin(address);
      if (!origin) return { error: "address" };
      const verifier = randomValue(32);
      await pendingArea.set({ [PENDING_KEY]: { origin, verifier, at: now() } });
      const challenge = await sha256Hex(verifier);
      return { url: `${origin}/chrome/connect#challenge=${challenge}`, origin };
    },

    /**
     * The Space's page handed back a pair code. Accepted only from the page of the address begin was given, within ten minutes, once.
     * @param {{ origin: string, code: string }} msg
     * @returns {Promise<{ ok: true, link: Omit<Linked, "token"> } | { ok: false, why: "nothing_pending" | "expired" | "wrong_page" | "refused" | "offline" }>}
     */
    async redeem(msg) {
      const raw = await pendingArea.get([PENDING_KEY]);
      const p = raw[PENDING_KEY];
      if (!p || typeof p.verifier !== "string" || typeof p.origin !== "string")
        return { ok: false, why: "nothing_pending" };
      if (now() - p.at > PENDING_MS) {
        await pendingArea.remove([PENDING_KEY]);
        return { ok: false, why: "expired" };
      }
      // only the page of the Space the person typed may hand over a code: never another site, another Space or a look-alike
      if (msg.origin !== p.origin || typeof msg.code !== "string" || msg.code.length > 64)
        return { ok: false, why: "wrong_page" };
      /** @type {Response} */
      let r;
      try {
        r = await doFetch(`${p.origin}/v1/identity/pair_redeem`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: msg.code,
            verifier: p.verifier,
            deviceName: DEVICE_NAME,
            deviceClass: "extension",
          }),
        });
      } catch {
        return { ok: false, why: "offline" };
      }
      /** @type {any} */
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      const token = body?.data?.session?.token;
      if (!r.ok || typeof token !== "string") return { ok: false, why: "refused" };
      // the value is spent with the code: a second attempt starts again from begin
      await pendingArea.remove([PENDING_KEY]);
      const link = { address: p.origin, token, space: "", name: new URL(p.origin).host };
      await keep([...(await links()).filter((l) => l.address !== p.origin), link]);
      for (const w of watchers) w({ address: p.origin, why: "linked" });
      return { ok: true, link: { address: link.address, space: link.space, name: link.name } };
    },

    /** Sign out of this Space here: the Space ends the session (best effort: it may be unreachable), the sockets close, the session is forgotten. @param {string} address */
    async signOut(address) {
      const mine = (await links()).find((l) => l.address === address);
      await forget(address, "signed_out");
      for (const o of [...open]) if (o.address === address) o.close();
      if (mine) {
        try {
          await doFetch(`${mine.address}/v1/identity/sign_out`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${mine.token}` },
            body: JSON.stringify({ idempotencyKey: `chrome-out-${randomValue(8)}` }),
          });
        } catch {
          /* the Space is away: the session is forgotten here, and can be signed out in Settings, Sign-in and devices */
        }
      }
    },

    /** Is there a Space this Chrome should talk to directly? */
    async active() {
      return (await links())[0] ?? null;
    },

    /**
     * A port with the shape of the native messaging port, over the Space's socket. Messages posted before the Space says ready wait their turn; the Space's pings are answered here
     * and never shown above. A refused, signed-out or revoked session forgets the link; any other loss is reported as a disconnect and the caller reconnects after a pause.
     * @param {Linked} link
     */
    openPort(link) {
      const ws = new WS(`${link.address.replace(/^http/, "ws")}${SOCKET_PATH}`);
      /** @type {((m: any) => void)[]} */
      const listeners = [];
      /** @type {(() => void)[]} */
      const closers = [];
      /** @type {string[]} */
      const queue = [];
      let ready = false;
      let ended = false;
      /** @type {any} */
      let helloTimer = null;
      /** @param {string} message */
      const end = (message) => {
        open.delete(handle);
        if (ended) return;
        ended = true;
        clearTimer(helloTimer);
        lastError = message;
        for (const c of closers) c();
      };
      const handle = {
        address: link.address,
        close() {
          try {
            ws.close();
          } catch {
            /* closed already */
          }
          end("signed out of the Space here");
        },
      };
      open.add(handle);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "hello", token: link.token }));
        helloTimer = setTimer(() => {
          try {
            ws.close();
          } catch {
            /* closed already */
          }
          end("the Space did not answer");
        }, o.helloMs ?? 10_000);
      });
      ws.addEventListener("message", (e) => {
        /** @type {any} */
        let m;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (!m || typeof m !== "object") return;
        if (m.type === "ping") {
          try {
            ws.send(JSON.stringify({ type: "pong" }));
          } catch {
            /* going away */
          }
          return;
        }
        if (m.type === "ready") {
          ready = true;
          clearTimer(helloTimer);
          // the Space's own name and id, for the switcher; kept so a later start shows them before the socket is up
          if (m.space && typeof m.space.id === "string") {
            void links().then((all) =>
              keep(
                all.map((l) =>
                  l.address === link.address
                    ? { ...l, space: m.space.id, name: String(m.space.name || l.name).slice(0, 80) }
                    : l,
                ),
              ),
            );
          }
          for (const q of queue.splice(0)) ws.send(q);
        }
        if (m.type === "refused") return;
        for (const f of listeners) f(m);
      });
      ws.addEventListener("close", (e) => {
        const code = /** @type {any} */ (e).code;
        if (code === CLOSE_SIGNED_OUT || code === CLOSE_REVOKED) {
          void forget(link.address, code === CLOSE_REVOKED ? "revoked" : "signed_out").then(() =>
            end(
              code === CLOSE_REVOKED
                ? "this Chrome was signed out of the Space"
                : "the Space does not know this Chrome; connect again",
            ),
          );
          return;
        }
        end(
          code === CLOSE_REPLACED
            ? "another Chrome window took over the connection"
            : "the connection to the Space closed",
        );
      });
      ws.addEventListener("error", () => end("could not reach the Space"));
      return {
        postMessage(/** @type {any} */ m) {
          if (ended) throw new Error("the connection to the Space is closed");
          const text = JSON.stringify(m);
          if (ready) ws.send(text);
          else queue.push(text);
        },
        disconnect() {
          open.delete(handle);
          ended = true;
          clearTimer(helloTimer);
          try {
            ws.close();
          } catch {
            /* closed already */
          }
        },
        onMessage: { addListener: (/** @type {(m: any) => void} */ f) => void listeners.push(f) },
        onDisconnect: { addListener: (/** @type {() => void} */ f) => void closers.push(f) },
      };
    },
  };
}

/**
 * The browser API the bridge and the agent channel are given: `connectNative` opens the Space's socket when this Chrome is connected to a Space directly, and the native host otherwise.
 * `lastError` carries the link's own words while a socket port reports its loss.
 * @param {any} ext @param {ReturnType<typeof createLink>} link @param {() => Linked | null} activeNow
 */
export function withLink(ext, link, activeNow) {
  let viaSocket = false;
  return {
    ...ext,
    runtime: {
      id: ext.runtime.id,
      get lastError() {
        return viaSocket ? { message: link.lastError } : ext.runtime.lastError;
      },
      connectNative(/** @type {string} */ name) {
        const l = activeNow();
        viaSocket = l !== null;
        return l ? link.openPort(l) : ext.runtime.connectNative(name);
      },
    },
  };
}

/**
 * The link for this browser, read from and watched in extension storage: the worker's bridge and the agent channel each take one, and both see the same session.
 * @param {any} ext
 */
export function linkFor(ext) {
  const link = createLink({
    local: ext.storage.local,
    ...(ext.storage.session ? { session: ext.storage.session } : {}),
  });
  void link.refresh().catch(() => {});
  if (ext.storage.onChanged) ext.storage.onChanged.addListener(() => void link.refresh().catch(() => {}));
  return link;
}

/** The browser API for something that talks to the app: the Space's socket when connected directly, else the native host. @param {any} ext */
export function linkedExt(ext) {
  if (!ext.storage || !ext.storage.local || typeof ext.storage.local.get !== "function" || !ext.runtime.connectNative)
    return ext;
  const link = linkFor(ext);
  return withLink(ext, link, link.current);
}
