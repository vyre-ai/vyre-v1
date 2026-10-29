# Getting started with Vyre

This guide takes a team of five from nothing to working. You will set up a server for your team's Space, put the app on each person's computer and phone, and invite everyone. It takes about an hour, most of it waiting for downloads.

Every command and address below is for the current release. Releases live at https://github.com/vyre-ai/vyre-v1/releases. Release candidates (names like `v1.0.0-rc.3`) are marked "pre-release" there and use the beta channel. The newest final release uses the stable channel. Where this guide shows a link under `releases/latest/download/`, a release candidate has to use `releases/download/channel-beta/` instead, and add `--channel beta` to the installer.

You can start with the app alone. Your computer is a **Personal Space** from the first launch, with no server and no account. The server is for the **Team Space** that your team shares.

## How the pieces fit

- **The Space** is your team's shared place: chats, files, records, the Vault, your agents. It lives on one server.
- **The server** runs the Space. It can be a Linux machine or a Mac that stays on.
- **The app** is how people use the Space. It runs on a Mac or a Windows PC. A phone uses the same Space through the browser, added to the home screen.
- **Vyre for Chrome** is an extension that fills logins from the Vault and saves new ones.

You need one server, and the app on each computer.

## 1. Install the server on Linux

You need a Linux machine you control, with root access, at least 10 GB free, and Docker (the installer adds Docker on Debian and Ubuntu if it is missing).

The machine's data disk has to be encrypted. The installer checks this and stops with the steps to fix it if the disk is not encrypted. On a cloud machine, turn on disk encryption for the volume, or attach an encrypted one. There is no switch to skip this.

Run this as root:

```sh
curl -fsSL https://github.com/vyre-ai/vyre-v1/releases/latest/download/install.sh | sudo sh -s -- --relay
```

`--relay` lets your team reach the server through Vyre's relay, so the machine opens no public port. If you would rather use your own domain, point a DNS record at the machine, open ports 80 and 443, and use `--domain vyre.example.com` instead. Pick one of the two.

The installer checks the release against Vyre's signature before it installs anything, starts the server, and waits until it reports healthy. When it finishes it tells you so. Check it any time with:

```sh
vyre-server doctor
```

The server updates itself once a day. It takes a backup first, checks that the new version is healthy, and goes back to the old version if it is not. `vyre-server update --check` shows what is available, and `vyre-server rollback` goes back one version.

To remove it, run the same line with `--uninstall` in place of `--relay`. Your data and backups stay unless you add `--purge` as well.

## 2. Install the server on a Mac

A Mac works as a server if it stays on and awake. You need:

- FileVault turned on (System Settings, Privacy and Security, FileVault). The installer refuses without it, for the same reason as the Linux disk check.
- Docker Desktop or OrbStack, opened once.
- Homebrew's OpenSSL and jq: `brew install openssl@3 jq`. The OpenSSL that ships with macOS cannot check Vyre's signature.

Run this as yourself, not with sudo:

```sh
curl -fsSL https://github.com/vyre-ai/vyre-v1/releases/latest/download/install-mac.sh | sh -s -- --relay
```

The server starts when you log in, and it updates itself every night at 4. Docker has to be open. A Mac that goes to sleep stops serving, so set it to stay awake when plugged in (System Settings, Battery).

The command `vyre-server` lands in `~/.local/bin`. If your shell does not find it, add that folder to your PATH. To remove the server, run the same line with `--uninstall` in place of `--relay`.

**A lighter option for one Mac.** The desktop app can also run a Space on your Mac while the app is open: in the app choose Create a Space, then Team Space, then Run this Mac as the Space server. Your team reaches it through the relay while the app is open. Use the installer above for anything that has to stay up when nobody is at the Mac.

## 3. Open your Space for the first time

The first time the server starts, it prints a one-time link that makes you the owner. It is valid for 24 hours. Read it from the server's log:

```sh
vyre-server logs vyred
```

Look for the line that starts with "Claim this Space as its owner", copy the link, and press Ctrl-C to stop following the log. If the link starts with `http://0.0.0.0`, replace that start with the address your team will use to reach the server. Install the app on your own computer (next two sections), choose Create a Space, then Team Space, paste the link, and pick your name and password.

## 4. Install the Mac app

1. Download the `.dmg` from the release page (`Vyre_<version>_aarch64.dmg`, for Macs with Apple chips).
2. Open it and drag Vyre into Applications.
3. The first time, do not double-click. **Right-click Vyre in Applications and choose Open**, then choose Open again in the box that appears. Vyre does not carry an Apple developer certificate yet, so macOS asks once. If macOS blocks it anyway (newer versions do), open System Settings, Privacy and Security, scroll down, and choose Open Anyway.

After that Vyre opens like any other app. It updates itself: in Settings, This computer, choose Check for updates. It only installs when you say so.

## 5. Install on Windows

A Windows PC is a full client: it runs the app, your Personal Space and your own compute. It does not host a server.

In PowerShell:

```powershell
irm https://github.com/vyre-ai/vyre-v1/releases/latest/download/install.ps1 | iex
```

Or download `VyreSetup.exe` from the release page and run it. The installer checks its own SHA-256 against `SHA256SUMS` on the release. Windows may say it does not recognize the app. Choose More info, then Run anyway.

The AI tools that run as command lines (Claude Code, Codex, Grok, Gemini CLI) need WSL2 on Windows. If you want them on this PC, open PowerShell as administrator and run `wsl --install`. Without WSL2 they run on your Space server instead.

## 6. Add your phone

There is no phone app in the first release. The phone uses the web app, added to the home screen so it opens like an app.

1. On the phone, open your Space's address in Safari (iPhone) or Chrome (Android). It is the address your team uses to reach the server.
2. Sign in.
3. iPhone: tap Share, then Add to Home Screen. Android: open the browser menu and choose Install app or Add to Home screen.

Push notifications are not in the first release. Open the app to see what needs you.

## 7. Add Vyre for Chrome

Vyre for Chrome fills logins and codes from your Vault and offers to save new logins. It is not in the Chrome Web Store yet, so you add it by hand once. The app does the hard part.

1. In the Vyre app on your Mac or PC, open the Vault, then Advanced, then Browsers.
2. Choose Install Vyre for Chrome. The app copies the extension to a folder of its own and tells Chrome where to find the app.
3. In Chrome, open `chrome://extensions` (the app has a button for it) and turn on Developer mode at the top right.
4. Choose Load unpacked and pick the folder the app shows you.
5. Pin Vyre for Chrome from Chrome's puzzle-piece menu.

The extension talks only to the Vyre app on the same computer. Today it works with a Space that runs on that computer: your Personal Space, or a Mac running as the Space server. For a Space on a Linux server, use the web app's Vault for now.

If you only want the files, `vyre-chrome.zip` is on every release.

## 8. Invite your team

1. In the app, open the Console, then People.
2. Under Invite a person, enter their email if you want one, choose a role, and create the invite. The link carries your Space's address, a one-time code and the Space's key fingerprint.
3. Send the link. If you are inviting several people, make one invite each. They expire.

Each person opens the link. The page shows your Space's name and who invited them. They pick a username and a password, and their computer makes its own keys. They can then choose Open in Vyre, Download Vyre, or Continue in the browser. Their first step inside is connecting an AI account (a subscription, their own key, or a key you attach to the invite).


## When something is wrong

- **The server:** run `vyre-server doctor`. It lists what is down and says how to fix each thing.
- **The app cannot reach the Space:** check the address, and run `vyre-server status` on the server.
- **Logs:** `vyre-server logs vyred` (the Space) or `vyre-server logs caddy` (the web front door). Press Ctrl-C to stop following.
