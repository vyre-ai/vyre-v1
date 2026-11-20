// What the runner lets through for the WORD CONVERTER (lane r42-docs, 19 Nov), the same pattern as agent workspaces (workspaces-policy.ts): every request is judged here before Docker sees it, and anything not named
// is refused. A conversion is one short-lived container vyre-conv-<16 hex>, labelled vyre.conv=1, from the converter image PINNED BY DIGEST (ghcr.io/vyre-ai/doc-converter@sha256:...; a tag or a local name is
// never accepted, so only the image this release was built with can run, and it is never fetched by a name). It runs as 10002, with no network at all, every capability dropped, no new privileges, a memory and
// process cap, one small memory-backed /tmp and nothing else: no bind, volume, device, port, host namespace or command of its own (the image's fixed entrypoint converts /in/in.docx to /out/in.pdf).
// The host may start, wait for, inspect and remove it, copy ONE file into /in and ONE file out of /out/in.pdf. No exec, no logs, no stop and no restart. Mirrors host/src/seams/doc-converter.ts.
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export const CONV_NAME = /^vyre-conv-[a-f0-9]{16}$/;
export const CONV_DIGEST = /^ghcr\.io\/vyre-ai\/doc-converter@sha256:[0-9a-f]{64}$/;
export const isConverterImage = (name: string): boolean => CONV_DIGEST.test(name);
export const CONV_MAX = { memory: 2 * 1024 ** 3, pids: 512, tmpMb: 512 };
export const CONV_USER = "10002:10002";

const emptyish = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === false ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (isObj(v) && Object.keys(v).length === 0);

const TOP_KEYS = new Set(["Image", "User", "NetworkDisabled", "Labels", "HostConfig"]);
const HOST_KEYS = new Set(["NetworkMode", "CapDrop", "SecurityOpt", "Memory", "PidsLimit", "Tmpfs"]);

/** Is this container a converter's (by its labels)? */
export const converterOf = (labels: Record<string, string> | null | undefined): boolean =>
  labels?.["vyre.conv"] === "1";

/** A converter's container create body, or why it is refused. */
export function converterBody(name: string, body: unknown): { body: Record<string, unknown> } | { why: string } {
  if (!CONV_NAME.test(name)) return { why: "a converter container is named vyre-conv-<16 hex>" };
  if (!isObj(body)) return { why: "the container config is not an object" };
  for (const k of Object.keys(body))
    if (!TOP_KEYS.has(k) && !emptyish(body[k])) return { why: `a converter container may not set ${k}` };
  if (!isConverterImage(String(body["Image"] ?? "")))
    return { why: "a converter runs the Word converter image, pinned by digest" };
  if (body["User"] !== CONV_USER) return { why: `a converter runs as ${CONV_USER}` };
  if (body["NetworkDisabled"] !== true) return { why: "a converter has no network (NetworkDisabled)" };
  const labels = isObj(body["Labels"]) ? body["Labels"] : {};
  for (const k of Object.keys(labels))
    if (k !== "vyre.conv" && !(k === "vyre.space" && /^spc_[A-Za-z0-9_-]{1,64}$/.test(String(labels[k]))))
      return { why: `a converter container may not carry the label ${k}` };
  if (labels["vyre.conv"] !== "1") return { why: "a converter container carries vyre.conv=1" };
  const h = isObj(body["HostConfig"]) ? body["HostConfig"] : null;
  if (!h) return { why: "a converter container needs its limits" };
  if (h["Privileged"] === true) return { why: "privileged containers are refused" };
  for (const k of Object.keys(h))
    if (!HOST_KEYS.has(k) && !emptyish(h[k])) return { why: `a converter container may not set HostConfig.${k}` };
  if (h["NetworkMode"] !== "none") return { why: "a converter has no network (NetworkMode none)" };
  if (!Array.isArray(h["CapDrop"]) || !(h["CapDrop"] as unknown[]).includes("ALL"))
    return { why: "every capability must be dropped" };
  const sec = Array.isArray(h["SecurityOpt"]) ? (h["SecurityOpt"] as unknown[]) : [];
  if (!sec.includes("no-new-privileges:true") && !sec.includes("no-new-privileges"))
    return { why: "new privileges must be off" };
  if (sec.some((o) => o !== "no-new-privileges:true" && o !== "no-new-privileges"))
    return { why: "a converter container takes no security option but no-new-privileges" };
  const mem = h["Memory"];
  if (typeof mem !== "number" || mem < 128 * 1024 ** 2 || mem > CONV_MAX.memory)
    return { why: `a converter has a memory cap of at most ${CONV_MAX.memory / 1024 ** 3} GB` };
  const pids = h["PidsLimit"];
  if (typeof pids !== "number" || pids < 1 || pids > CONV_MAX.pids)
    return { why: `a converter has a process cap of at most ${CONV_MAX.pids}` };
  const tmp = h["Tmpfs"];
  if (tmp !== undefined && !emptyish(tmp)) {
    const ok =
      isObj(tmp) &&
      Object.keys(tmp).length === 1 &&
      typeof tmp["/tmp"] === "string" &&
      (() => {
        const m = /^rw,size=(\d{1,4})m(,uid=10002,gid=10002)?$/.exec(tmp["/tmp"] as string);
        return m !== null && Number(m[1]) >= 1 && Number(m[1]) <= CONV_MAX.tmpMb;
      })();
    if (!ok)
      return { why: `a converter has one memory-backed /tmp of at most ${CONV_MAX.tmpMb} MB and no other mount` };
  }
  return {
    body: {
      Image: body["Image"],
      User: CONV_USER,
      NetworkDisabled: true,
      Labels: labels,
      HostConfig: {
        NetworkMode: "none",
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        Memory: mem,
        MemorySwap: mem,
        PidsLimit: pids,
        Privileged: false,
        ...(tmp !== undefined && !emptyish(tmp) ? { Tmpfs: tmp } : {}),
        LogConfig: { Type: "json-file", Config: { "max-size": "1m", "max-file": "1" } },
        AutoRemove: false,
      },
    },
  };
}

/** What may be asked of a converter's container: read it, start it, wait for it, remove it (force and volumes only), copy one file in and one file out. */
export function converterAllows(
  action: string,
  method = "GET",
  query: URLSearchParams = new URLSearchParams(),
): boolean {
  const keys = [...query.keys()];
  if (action === "json") return method === "GET" && keys.length === 0;
  if (action === "start" || action === "wait") return method === "POST" && keys.length === 0;
  if (action === "remove") return method === "DELETE" && keys.every((k) => k === "force" || k === "v");
  if (action === "archive")
    return (
      keys.length === 1 &&
      keys[0] === "path" &&
      ((method === "PUT" && query.get("path") === "/in") || (method === "GET" && query.get("path") === "/out/in.pdf"))
    );
  return false;
}
