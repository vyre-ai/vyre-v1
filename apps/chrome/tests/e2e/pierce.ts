// Finding and pressing things inside a closed shadow root (the agent bar, the save card, the field badge and its picker) in a real Chromium: the DevTools protocol can pierce a closed root, a page script cannot.
import assert from "node:assert/strict";

/** The centre of the first element with this tag whose own text is `label` (or whose aria-label is), anywhere on the page including closed shadow roots. */
export async function boxOf(page: any, tag: string, label: string, waitMs = 4000) {
  const until = Date.now() + waitMs;
  for (;;) {
    const got = await once(page, tag, label);
    if (got) return got;
    if (Date.now() > until) assert.fail(`a <${tag}> "${label}" is on the page`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function once(page: any, tag: string, label: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const walk = (n: any): any => {
      if (n.nodeName === tag.toUpperCase()) {
        const kid = (n.children ?? []).find((c: any) => c.nodeType === 3);
        const attrs = n.attributes ?? [];
        const aria = attrs[attrs.indexOf("aria-label") + 1];
        if ((kid && kid.nodeValue === label) || (attrs.includes("aria-label") && aria === label)) return n;
      }
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) { const hit = walk(c); if (hit) return hit; }
      return null;
    };
    const node = walk(root);
    if (!node) return null;
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId });
    const [x1, y1, , , x3, y3] = model.content;
    return { x: (x1 + x3) / 2, y: (y1 + y3) / 2 };
  } finally { await cdp.detach().catch(() => {}); }
}

/** Press it with a real (trusted) mouse click. */
export async function press(page: any, tag: string, label: string) {
  const b = await boxOf(page, tag, label);
  await page.mouse.click(b.x, b.y);
}
