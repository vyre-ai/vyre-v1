// Keep the large generated portrait catalogs out of first paint. Every Avatar shares these module promises through ESM caching; agent portraits replace their tinted fallback after they resolve.
export const loadNotionists = () => import("./notionists.ts");
/** The curated library (Faces, Friends, Blobs, Glass): drawn with @dicebear/core here, never from a service. */
export const loadLibrary = () => import("./library.ts");
