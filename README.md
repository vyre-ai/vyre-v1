# Vyre

Vyre is one app for a team and its AI agents. Chats, records, files, an inbox, automations and a shared Vault live in one Space. People and agents use the same Space under the same permissions. Secrets stay in the Vault, and agents use them by handle without seeing the values.

Your computer starts as a **Personal Space** with no server and no account. A **Team Space** lives on a server your team reaches, and people join it with an invite link.

## Get it running

[docs/getting-started.md](docs/getting-started.md) takes a team of five from nothing to working:

1. Install a server on Linux or on a Mac.
2. Install the Mac app, or the Windows app.
3. Add a phone as a web app on the home screen.
4. Add Vyre for Chrome.
5. Invite your team.

Downloads are on the [releases page](https://github.com/vyre-ai/vyre-v1/releases). Release candidates are marked pre-release.

The short version, on a Linux server:

```sh
curl -fsSL https://github.com/vyre-ai/vyre-v1/releases/latest/download/install.sh | sudo sh -s -- --relay
```

The installer checks the release against Vyre's signature before it installs anything.

## What is in this repository

| Folder | What it holds |
|---|---|
| `apps/app` | The app: the screens for every place, running on Mac, Windows, the phone browser and the web |
| `apps/desktop` | The Mac and Windows shell around the app (Tauri) |
| `apps/chrome` | Vyre for Chrome |
| `host`, `kernel`, `modules`, `manifests` | The server: the event log, access checks and the capabilities every screen and agent calls |
| `agent`, `sandbox` | How agents take turns and where their work runs |
| `client`, `sync`, `relay` | The local copy on each device, sync, and the relay that reaches a server without opening a port |
| `scripts/install` | The installers for Linux, Mac and Windows |
| `docs/spec` | The product spec and the architecture it is built to |
| `docs/release` | How a release is made and checked |

## Working on Vyre

Node 24. The tests run with `npm test`; `npm run test:affected` runs only what a change touches. Every change adds a file to `changelog.d/` named after its branch. [docs/release/runbook.md](docs/release/runbook.md) describes how a release is cut, signed and published.

Vyre is licensed under Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
