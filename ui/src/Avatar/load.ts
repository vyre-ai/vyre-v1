// Keep the large generated portrait catalog out of first paint. Every Avatar shares this module
// promise through ESM caching, and agent portraits replace their tinted fallback after it resolves.
export const loadNotionists = () => import("./notionists.ts");
