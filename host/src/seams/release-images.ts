// Which image a host asks Docker for: an agent's workspace, the Space browser, the old agent computer.
//   A server's settings name each image by digest (compose.env, written from the release's images.lock). When a setting is missing or empty (a server whose update tool is older than the
//   release and so never wrote the line, a Space in the desktop app, a hand-started daemon), the host asks for this release's own image by its version tag on ghcr.io/vyre-ai, the one registry
//   Vyre publishes to. It never falls back to a bare `vyre/...` name: with no registry host Docker would look for that on Docker Hub, where the namespace is not Vyre's.
//   A caller that gives no version (a unit test of a seam) gets the local build name, which is used only when it is already on the computer and is never fetched
//   (sandbox/src/docker.ts fetchableImage; the runner refuses the same fetch in sites-runner/policy.ts).
export type ReleaseImage = "agent-workspace" | "vyre-browser" | "agent-computer";

export const OWN_REGISTRY = "ghcr.io/vyre-ai";
/** The names a local build has (images/*: `docker build -t ...`). Never fetched. */
export const LOCAL_IMAGE: Record<ReleaseImage, string> = { "agent-workspace": "vyre/agent-workspace:1", "vyre-browser": "vyre/space-browser:1", "agent-computer": "vyre/agent-computer:1" };

// a Docker tag: letters, digits, underscore, dot and dash, at most 128, not starting with a dot or dash. A version with build metadata (`+...`) is not one.
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** The image to ask for: the setting when it names one, else this release's image by version, else the local build name. */
export function releaseImage(kind: ReleaseImage, version: string | undefined, named?: string | undefined): string {
  const set = (named ?? "").trim();
  if (set !== "") return set;
  const v = (version ?? "").trim();
  return TAG.test(v) ? `${OWN_REGISTRY}/${kind}:${v}` : LOCAL_IMAGE[kind];
}
