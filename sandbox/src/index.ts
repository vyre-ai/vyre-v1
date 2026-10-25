export type { CredentialFile, ExecResult, ExecSpec, Limits, Mount, Roots, Sandbox, SandboxKind, SandboxSpec } from "./types.ts";
export { DEFAULT_LIMITS, SandboxError } from "./types.ts";
export { hostAllowed, isPrivateAddress, normalizePath, validHostPattern, validateSpec, within } from "./policy.ts";
export type { Checked, PolicyOptions } from "./policy.ts";
export { createEgressProxy } from "./egress.ts";
export type { EgressEvent, EgressOptions, EgressProxy } from "./egress.ts";
export { CRED_DIR, DEFAULT_IMAGE, HOME, containerConfig, createDockerApi, demux, networkName, proxyEnv, reviewContainerConfig, unixSocketHttp } from "./docker.ts";
export type { ContainerConfig, DockerApi, DockerHttp, DockerRequest, DockerResponse, DockerSandboxDeps, ProxyHandle } from "./docker.ts";
export { SYSTEM_READ, sbplString, seatbeltCommand, seatbeltProfile } from "./seatbelt.ts";
export type { SeatbeltOptions } from "./seatbelt.ts";
// The unwalled starters (startDockerSandbox, bwrapCommand) are not exported: a sandbox started through them keeps a network path to the host that the wall closes (P-L2_HEAVY found it). The
// only starters are the walled ones below (ruling: security sign-off S8). Their own unit tests import ./docker.ts and ./bwrap.ts directly.
export { bwrapWallCommand, startNetWall, startWalledBwrapSandbox, startWalledDockerSandbox } from "./net/index.ts";
export type { BwrapWallOptions, NetWall, NetWallOptions, WalledCommand } from "./net/index.ts";
export type { WalledBwrapDeps, WalledBwrapSandbox, WalledDockerDeps, WalledSandbox } from "./net/index.ts";
export type { BwrapOptions } from "./bwrap.ts";
export { createCredentialStore, nodeCredFs } from "./creds.ts";
export type { CredFs, CredentialStore, CredentialStoreOptions, DirEntry } from "./creds.ts";
export { tarFiles, tarPath, untar } from "./tar.ts";
export type { TarFile } from "./tar.ts";
export { chooseSandbox } from "./select.ts";
export type { Choice, Where } from "./select.ts";
export { confinementProbe } from "./probe.ts";
export type { ProbeOptions, ProbeResult } from "./probe.ts";
