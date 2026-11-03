// The one place the CLI engines' versions are pinned: the version of Claude Code, Codex and Grok that Vyre installs into its own engines folder (engine-install.ts) and bakes into the server image
// (images/vyred/Dockerfile runs bake-engines.ts). Each build names the vendor's own download, its size and SHA-256, and the size and SHA-256 of the program inside it, so a download is checked against
// what is written here before anything is made executable, never against what the server says about itself. Bump a version on purpose: fetch the vendor's files, check them against the vendor's own list
// (Claude Code's manifest.json and manifest.zst.json, the digests GitHub shows on a Codex release; Grok publishes none, so its sums were taken from the files and matched against a copy xAI's own installer
// put on a Mac), and write all four numbers.

/**
 * The computers Vyre installs engines on. A Linux built against musl (Alpine) is its own entry: Claude Code ships a separate build for it; Codex and Grok are static, so the same file serves both.
 * Windows builds are programs ending in .exe (engine-install.ts programFile).
 */
export type EnginePlatform = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "linux-x64-musl" | "linux-arm64-musl" | "win32-x64" | "win32-arm64";

export interface EngineBuild {
  /** The vendor's file: the program, compressed with zstd. */
  url: string;
  size: number;
  sha256: string;
  /** The program once unpacked. */
  binarySize: number;
  binarySha256: string;
}

export interface EnginePin {
  program: "claude" | "codex" | "grok";
  version: string;
  /** The only hosts a download may touch, the redirects it follows included. */
  hosts: readonly string[];
  builds: Readonly<Partial<Record<EnginePlatform, EngineBuild>>>;
}

const claude = (platform: string, size: number, sha256: string, binarySize: number, binarySha256: string, file = "claude.zst"): EngineBuild =>
  ({ url: `https://downloads.claude.ai/claude-code-releases/2.1.316/${platform}/${file}`, size, sha256, binarySize, binarySha256 });
const codex = (triple: string, size: number, sha256: string, binarySize: number, binarySha256: string): EngineBuild =>
  ({ url: `https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-${triple}.zst`, size, sha256, binarySize, binarySha256 });
const grok = (platform: string, size: number, sha256: string, binarySize: number, binarySha256: string): EngineBuild =>
  ({ url: `https://x.ai/cli/grok-1.0.70-${platform}.zst`, size, sha256, binarySize, binarySha256 });

const CODEX_LINUX_X64 = codex("x86_64-unknown-linux-musl", 86978850, "5a2832a53f9366c5f57a1fee7639822d2a7b4527bc26cfb2ea67b00ef2bca87d", 319346888, "b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8");
const CODEX_LINUX_ARM64 = codex("aarch64-unknown-linux-musl", 81961890, "cae38c9a99d13ed0515d294e1eb094592118b43461cb907402bdf9fda94aa76a", 277549176, "f2e6c980c937e734644bed1b4a9a018d3e63a0ccbe71aafc85c86a8c6e4b462a");
const GROK_LINUX_X64 = grok("linux-x86_64", 57553935, "e751b614949d8458702367b0e0f333904c58258ad3e431a7226b14a42b74f847", 195700192, "22d281c5964c5444147328096ba2a221f3f0874c6858e27c825656a80f6e58e9");
const GROK_LINUX_ARM64 = grok("linux-aarch64", 54274393, "1c528d71c8abcc67d3b1eaa3715e0be512a582e79b2043dea75a0c951deec61c", 166639048, "3aa36883574b263088e5addffe241f55430e8daaee1a0c4934b02180007a9761");

export const ENGINE_PINS: Readonly<Record<EnginePin["program"], EnginePin>> = Object.freeze({
  claude: {
    program: "claude", version: "2.1.316", hosts: ["downloads.claude.ai"],
    builds: {
      "darwin-arm64": claude("darwin-arm64", 106990783, "e43d57df0ce383e084b22f1d4fb7be6e0bdb1d40b4ceb042f3cfba96d5ec468f", 310114176, "64c327e92b2c5e0f78c0a980c5a518121e1f0d140ca771ca5dd4488d1a2dcb3f"),
      "darwin-x64": claude("darwin-x64", 113964923, "df7365b5c8019682aa8cf5e66b5547e9fa4980bc74ed64dbac4c1eb45ef228e5", 324381312, "203d22fbafdab9f6b0cda962ec573e32ab970894c63b1dfb0409378f28b9c344"),
      "linux-x64": claude("linux-x64", 118793137, "4108764100675c0773d98011d5091f427f30eebfc567aa9f1b5f4d9a54630a10", 328262000, "fd13c70000fec3f2116dfbcbb6121210b4a29328bf0e46210a59dd594a67d824"),
      "linux-arm64": claude("linux-arm64", 117001734, "d4ed34a7ecd889497fccc0951c869867b2369196804e3d83b8e486d424b973e1", 328459544, "55cdb8e162d190432696ea54010e0fca2e18d06fa7a7127fd563b9ffd4f22624"),
      "linux-x64-musl": claude("linux-x64-musl", 113886207, "113294cd5db89a1a8b94406622cbe2b663a7c922a43b2e0d44bfd7d93d931438", 314779944, "8bc3d015479b8b87dfde3f69f9bdb96c658758a8eb31892fd8fbece8d8a08bcf"),
      "linux-arm64-musl": claude("linux-arm64-musl", 112468657, "de9af064a067f4c2944c65751f76b671c1228465c271a8e1773ac65598ca04cc", 311914480, "d774cb39055cff62af476af32702f1fc4f888a7e395a37434a95d6f5a98818a0"),
      // manifest.zst.json (claude.exe.zst) and manifest.json (claude.exe) of 2.1.316; the downloads were checked against both
      "win32-x64": claude("win32-x64", 122064664, "26af66d4fa70e980047d54c85140579de0271d79a9257ac467f90a0ecdca528d", 335469216, "e896a9d8da519353a49bf69ca4a695ba7e09067752687c675b3969041e632d52", "claude.exe.zst"),
      "win32-arm64": claude("win32-arm64", 115553923, "fc420bf59ecf1f27bdf8aff5d06dc6ed01187f6ada3f71411ce45ce392f210fb", 315967648, "a44168f2360bf21709855321b25f1eeb021de8a8d4be5d25a8b397dcbf9043f8", "claude.exe.zst"),
    },
  },
  codex: {
    program: "codex", version: "0.166.0", hosts: ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"],
    builds: {
      "darwin-arm64": codex("aarch64-apple-darwin", 76852735, "ca1c559c977c6e14ccd67766af898f6837c0d19339ebd579167ca30fa3a8cd01", 268972064, "39acf979729dd290f9a24ee38b2914e036c91b65952872e28ae2a6b88a7db7c1"),
      "darwin-x64": codex("x86_64-apple-darwin", 84411155, "54de013d725a174ae86d8a3692c46ffa8ae6f9158fc4d5c1155307f17206e116", 289445104, "1361e18268866b7f9f5e8703fabcea0a2a990a439eedcce03940abb4ba9eaaeb"),
      "linux-x64": CODEX_LINUX_X64, "linux-x64-musl": CODEX_LINUX_X64,
      "linux-arm64": CODEX_LINUX_ARM64, "linux-arm64-musl": CODEX_LINUX_ARM64,
      // the digests GitHub shows for codex-<triple>.exe.zst and codex-<triple>.exe; the downloads were checked against both
      "win32-x64": codex("x86_64-pc-windows-msvc.exe", 91527326, "5aa3c88e75bd0c843c48e2fe7062999546f0d3094a3361659c2d731dfdf84960", 371735856, "9d563ee4e0441ff9d59d612013e0460ddf8e5709735c2d9f6b98b7ef8ca4eb42"),
      "win32-arm64": codex("aarch64-pc-windows-msvc.exe", 84641843, "c87aa6cd5e52b782fe656321847dce0633d1fb7dc51f5f1fbe58f32975d31b1b", 313027888, "d92bb6a3259980a742049882f396eb09eb26734589accc7f2c5173b7ab926138"),
    },
  },
  grok: {
    program: "grok", version: "1.0.70", hosts: ["x.ai"],
    builds: {
      "darwin-arm64": grok("macos-aarch64", 53423354, "f6fbbc48d04fb7e99210cb597f44a5fb8150e770f363fcf70e3f537312e3dfcf", 179063008, "5c8a688251bf61e35370b828b6a353b0a20fcc3f64000de8a91d426039f29cec"),
      "darwin-x64": grok("macos-x86_64", 57935399, "9b47b294f70df257e73536dcf1a52bfa034861961d47dec153980771f4f55506", 193578304, "d9ecd462f1f3c3b40a7a131944987ee7ed1c38069b7009cc4107398ab767f484"),
      "linux-x64": GROK_LINUX_X64, "linux-x64-musl": GROK_LINUX_X64,
      "linux-arm64": GROK_LINUX_ARM64, "linux-arm64-musl": GROK_LINUX_ARM64,
      // taken from the files (xAI publishes no sums); the .exe.zst unpacks to the same bytes as the plain .exe its own installer fetches
      "win32-x64": grok("windows-x86_64.exe", 52172755, "cc69e42ea18aeb73ca90015139ddc01e1969d34e02a0cdda75803eb78c84587a", 176011920, "1e03c16cf2bd4626a79d6b1ea1430f88c38e0c8ec75edd283a60de11296ba326"),
      "win32-arm64": grok("windows-aarch64.exe", 49847430, "3d69574f1499813a38c88b476e4941767821ce99e0161e2da0f8de61693d1af7", 149485200, "0e3584b6ab8df12e480c1b9ef37f26330b68c080b50bdb7b2f386de8133bc6c0"),
    },
  },
});

/** The pin of a program Vyre can install, or undefined. */
export const pinOf = (program: string): EnginePin | undefined => (Object.hasOwn(ENGINE_PINS, program) ? ENGINE_PINS[program as EnginePin["program"]] : undefined);
