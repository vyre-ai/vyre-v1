// Shared by the Show Vyre how and Watch a page end-to-end tests: fixture pages, the side panel opened as its own window, the proof screenshots, the agents the fake app lists.
export const SECRET = "hunter2-Pa55";
export const USER = "techmanager@mylegalacademy.com";

export const STYLE = `<style>body{font:15px system-ui,sans-serif;margin:0;background:#F5F7FB;color:#1d2433}header{height:52px;background:#fff;border-bottom:1px solid #E4E8F0;display:flex;align-items:center;padding:0 18px;font-weight:600}
main{padding:24px;max-width:560px}label{display:block;font-size:12px;color:#6B778C;margin:12px 0 4px}input{width:100%;box-sizing:border-box;height:34px;border:1px solid #D5DBE6;border-radius:6px;padding:0 10px;font:inherit}
button{margin-top:16px;height:34px;padding:0 16px;border:0;border-radius:7px;background:#4338ca;color:#fff;font:inherit}#going{font-size:28px;font-weight:600}</style>`;
export const PORTAL = `<!doctype html><meta charset="utf-8"><title>Acme Portal</title>${STYLE}<header>Acme Portal</header><main><h1>Sign in</h1>
<form action="/new" method="get"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form></main>`;
export const NEW = `<!doctype html><meta charset="utf-8"><title>New contact</title>${STYLE}<header>New contact</header><main><label for="n">Name</label><input id="n"><label for="m">Email</label><input id="m" type="email">
<button type="button" id="save" onclick="document.getElementById('done').textContent='Saved '+document.getElementById('n').value+' <'+document.getElementById('m').value+'>'">Save</button><p id="done"></p></main>`;
export const lab = { going: "3,412 going" };
export const LAB = () => `<!doctype html><meta charset="utf-8"><title>AI Lab 8 · Luma</title>${STYLE}<header>Luma</header><main><h1>AI Lab 8</h1><h3>Guest count</h3><div id="going">${lab.going}</div><p>Thu 6 Nov, 6:00 PM ET</p></main>`;

export async function openPanelFor(r: any, pageUrlPrefix: string, w = 400) {
  const winId = await r.worker.evaluate(async (prefix: string) => {
    const c = (globalThis as any).chrome;
    const tabs = await c.tabs.query({});
    return (tabs.find((x: any) => String(x.url).startsWith(prefix)) ?? tabs[0]).windowId;
  }, pageUrlPrefix);
  const waiting = r.context.waitForEvent("page", { predicate: (p: any) => p.url().includes("/src/panel/panel.html") });
  await r.worker.evaluate(async (id: number) => { await (globalThis as any).chrome.windows.create({ url: `src/panel/panel.html?window=${id}`, type: "popup", width: 400, height: 760, focused: false }); }, winId);
  const panel = await waiting;
  if (process.env["VYRE_E2E_DEBUG"]) { panel.on("console", (m: any) => console.log("panel:", m.text())); panel.on("pageerror", (e: any) => console.log("panel error:", String(e))); r.worker.on("console", (m: any) => console.log("worker:", m.text())); }
  await panel.setViewportSize({ width: w, height: 760 });
  return panel;
}

/** One piece of UI as the proof shows it: a narrow window and a wide one, paper and graphite. */
export async function shootAll(r: any, page: any, name: string, back = { width: 400, height: 760 }) {
  for (const [scheme, tone] of [["light", "paper"], ["dark", "graphite"]] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [w, h] of [[390, 760], [1440, 900]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await r.shot(page, `${name}-${w}-${tone}`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(back);
}

export const AGENTS = () => ({ agents: [{ id: "agt_assist", name: "Assistant", assistant: true }, { id: "agt_ops", name: "Ops", role: "Operations", computer: true }, { id: "agt_scout", name: "Scout", role: "Sales follow-up", computer: false }], suggested: { id: "agt_assist", name: "Assistant" } });

