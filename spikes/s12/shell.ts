// Reads the Tauri 2 shell definition and checks the S12 contract:
// web build as frontendDist, vyre deep link, global shortcut, vyred sidecar,
// ad-hoc mac signing, NSIS on Windows, deb and appimage on Linux.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SPIKE_ROOT = path.dirname(fileURLToPath(import.meta.url));

export type ShellContract = {
  productName: string;
  identifier: string;
  frontendDist: string;
  signingIdentity: string;
  targets: string[];
  schemes: string[];
  externalBin: string[];
  shortcut: boolean;
  deepLink: boolean;
  sidecar: boolean;
  cspAllowsSidecar: boolean;
};

type Conf = {
  productName?: string;
  identifier?: string;
  build?: { frontendDist?: string };
  app?: { security?: { csp?: string } };
  bundle?: {
    targets?: string[] | string;
    externalBin?: string[];
    macOS?: { signingIdentity?: string };
  };
  plugins?: { "deep-link"?: { desktop?: { schemes?: string[] } } };
};

function asConf(value: unknown): Conf {
  if (!value || typeof value !== "object") throw new Error("tauri.conf.json is not an object");
  return value as Conf;
}

export function loadShell(root = SPIKE_ROOT): ShellContract {
  const conf = asConf(JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")));
  const lib = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
  const cargo = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const caps = fs.readFileSync(path.join(root, "src-tauri/capabilities/default.json"), "utf8");
  const targets = Array.isArray(conf.bundle?.targets)
    ? conf.bundle.targets
    : conf.bundle?.targets
      ? [conf.bundle.targets]
      : [];
  const schemes = conf.plugins?.["deep-link"]?.desktop?.schemes ?? [];
  const externalBin = conf.bundle?.externalBin ?? [];
  const csp = conf.app?.security?.csp ?? "";
  const contract: ShellContract = {
    productName: conf.productName ?? "",
    identifier: conf.identifier ?? "",
    frontendDist: conf.build?.frontendDist ?? "",
    signingIdentity: conf.bundle?.macOS?.signingIdentity ?? "",
    targets,
    schemes,
    externalBin,
    shortcut: lib.includes("CommandOrControl+Shift+V") && caps.includes("global-shortcut"),
    deepLink: schemes.includes("vyre") && lib.includes("tauri_plugin_deep_link") && cargo.includes("tauri-plugin-deep-link"),
    sidecar:
      externalBin.includes("binaries/vyred") &&
      lib.includes('sidecar("vyred")') &&
      lib.includes("VYRE_SIDECAR_PORT") &&
      cargo.includes("tauri-plugin-shell"),
    cspAllowsSidecar: csp.includes("http://127.0.0.1:47211"),
  };
  const missing: string[] = [];
  if (contract.productName !== "Vyre") missing.push("productName");
  if (contract.identifier !== "ai.vyre.desktop") missing.push("identifier");
  if (contract.frontendDist !== "../web") missing.push("frontendDist");
  if (contract.signingIdentity !== "-") missing.push("signingIdentity");
  if (!contract.targets.includes("app") || !contract.targets.includes("nsis")) missing.push("targets");
  if (!contract.targets.includes("deb") || !contract.targets.includes("appimage")) missing.push("linux");
  if (!contract.deepLink) missing.push("deepLink");
  if (!contract.shortcut) missing.push("shortcut");
  if (!contract.sidecar) missing.push("sidecar");
  if (!contract.cspAllowsSidecar) missing.push("csp");
  if (!cargo.includes("tauri-plugin-global-shortcut")) missing.push("shortcutCrate");
  if (missing.length) throw new Error(`shell contract: ${missing.join(", ")}`);
  return contract;
}
