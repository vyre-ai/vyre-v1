# Getting started with Vyre

This guide takes a team of five from nothing to working. You will set up a server for your team's Space, put the app on each person's computer and phone, and invite everyone. It takes about an hour, most of it waiting for downloads.

Every command below installs the current release. Releases live at https://github.com/vyre-ai/vyre-v1/releases. Right now every release is a release candidate (names like `v1.0.0-rc.24`, marked "pre-release" there), and those come on the **beta** channel, so the install lines below name it (`channel-beta` in the address and `--channel beta` at the end). When a final release is out, use `releases/latest/download/` in the address and leave `--channel beta` off.

You can start with the app alone. Your computer is a **Personal Space** from the first launch, with no server and no account. The server is for the **Team Space** that your team shares.

## How the pieces fit

- **The Space** is your team's shared place: chats, files, records, the Vault, your agents. It lives on one server.
- **The server** runs the Space. It can be a Linux machine or a Mac that stays on.
- **The app** is how people use the Space. It runs on a Mac or a Windows PC. A phone uses the same Space through the browser, added to the home screen.
- **Vyre for Chrome** is an extension that fills logins from the Vault and saves new ones.

You need one server, and the app on each computer.

## 1. Install the server on Linux

You need a Linux machine you control, with root access and at least 10 GB free. The installer adds Docker on Debian and Ubuntu if it is missing (it checks Docker's repository key against the fingerprint Docker publishes). On any other Linux, install Docker Engine and the Compose plugin first.

### Choose how people will reach the server

There are two ways, and you pick one when you install. You can change it later (see "Changing it later" below).

- **Your own name (`--domain`).** People open `https://vyre.example.com` in any browser, and the Vyre app connects to the same address. This is the way for a team, and the only way for someone who has only a browser. It needs a name you own and two DNS records (below).
- **Vyre's relay (`--relay`).** The server connects out to Vyre's relay and opens no port to the internet. Only the Vyre app (Mac or Windows) can find a server this way, and only through the install line the app shows you (it carries a one-time code). A server installed with `--relay` and no code has no web address a browser can open.

### Encrypting the data disk

Vyre keeps your Space's data, keys and backups on this machine's disk. By default the installer refuses to put them on a plain disk, and shows three ways forward. A default cloud server has a plain disk, so you will meet this on your first try.

1. **Use your provider's encrypted volume.** Attach an encrypted volume to the server, mount it (for example at `/mnt/vyre`), and install with `--data-dir /mnt/vyre/data --provider-encrypted`. The installer cannot see a provider's encryption from inside the server, so `--provider-encrypted` is your word that it is on; Vyre records that, and `vyre-server doctor` says "you said your provider encrypts it; check it with your provider". What the big providers say about themselves (check their current page; this changes, and Vyre cannot check it for you): Google Cloud and Microsoft Azure encrypt their disks at rest by default; Amazon Web Services encrypts a volume when you turn on encryption for it (or "encryption by default" for the region); DigitalOcean and Linode encrypt their block storage volumes, but not the server's own disk; Hetzner Cloud does not encrypt volumes for you, so use the next way there.
2. **Let the installer make one: `--encrypt-data`.** It makes a LUKS volume of 20 GB (change it with `--encrypt-size 50`), or uses a spare disk you name (`--encrypt-device /dev/sdb`, which erases it), and puts the data there. It asks you for a passphrase, or makes one for you and shows it once. It never stores the passphrase. What this means:
   - It protects a copy of the disk: a snapshot, a stolen or recycled drive, a backup of the whole disk.
   - It does not protect against someone who can log in to the server while it runs: the volume is open then.
   - After every restart the Space stays closed until you run `sudo vyre-server unlock` and type the passphrase. An update that restarts the machine needs you too.
   - You can instead keep the key in a file on another volume (`--key-file /mnt/usb/vyre.key`), and the server then opens by itself whenever that volume is mounted. The installer refuses a key file on the same disk as the data, because a key beside the data it opens protects nothing.
3. **Go without: `--allow-plain-disk`.** The installer records your choice. From then on `vyre-server doctor` and the Console's health page say, every time, that the data is not encrypted at rest.

On a Mac the same question is answered by FileVault (section 2), with the same `--allow-plain-disk` choice.

### The install line

Run this as root, on the server. With your own name:

```sh
curl -fsSL https://github.com/vyre-ai/vyre-v1/releases/download/channel-beta/install.sh | sudo sh -s -- --channel beta --domain vyre.example.com
```

Or, for a server only the Vyre app will use (copy the exact line from the app, which adds its one-time code):

```sh
curl -fsSL https://github.com/vyre-ai/vyre-v1/releases/download/channel-beta/install.sh | sudo sh -s -- --channel beta --relay
```

Add one of the disk options above (`--provider-encrypted`, `--encrypt-data` or `--allow-plain-disk`) if the installer asks for one. `--encrypt-data` asks you for a passphrase, so run it from a terminal.

The installer checks the release against Vyre's signature before it installs anything, starts the server, and waits until it reports healthy. Check it any time with:

```sh
vyre-server doctor
```

### A name for your server (`--domain`)

Before people can open `https://vyre.example.com`, three things have to be true. If you have an IT person, send them this list.

1. **An A record for the name.** An A record is a line in your domain's DNS settings (at the company where you bought the domain) that says "this name is this machine". Make `vyre.example.com` point to the server's public IP address, which the installer prints and your cloud provider shows on the server's page.
2. **A second A record, `a.vyre.example.com`, pointing to the same address.** Artifacts (pages your agents make) open on that name.
3. **Ports 80 and 443 open to the internet,** in the provider's firewall as well as on the machine. Port 80 is how the certificate is fetched, from Let's Encrypt, and 443 is the site.

When the installer finishes it looks the two names up, compares them with the server's own address, and says which one is missing or wrong. The certificate arrives about a minute after the records are right. Nothing else needs doing.

### Changing it later

Run the installer again with the other choice, for example `--domain vyre.example.com` on a server installed with `--relay`. The installer says what changed (`Changing how this server is reached: from ... to ...`), keeps the Space's data, and restarts the server with the new address. The disk choice is remembered between runs. To change it, run again with another of the three disk options.

### Day to day

- `sudo vyre-server claim-link` prints the one-time link that makes you the owner. A server with a name prints a real `https` address. A server with only the relay prints a link that opens on the server itself; the command says what to do.
- `vyre-server logs` follows the log until you press Ctrl-C. `vyre-server logs --no-follow` prints the last lines and exits.
- The server updates itself once a day. It backs up first, with the server still running, then stops it only for the switch, checks that the new version is healthy, and goes back to the old version if it is not. `vyre-server update --check` shows what is available, and `vyre-server rollback` goes back one version.
- `vyre-server backup` writes a backup while the server runs, and says where. **A backup on the same disk as the data is not protection:** if the server or its disk is lost, the backup goes with it. The command prints the one `scp` line that copies it to your own computer. Keep a copy somewhere else.
- To remove the server, run the same line with `--uninstall` in place of the other options. Your data and backups stay unless you add `--purge`. From a pipe the installer cannot ask you to confirm a purge, so add `--yes`: `... | sudo sh -s -- --uninstall --purge --yes`.

## 2. Install the server on a Mac

A Mac works as a server if it stays on and awake. You need:

- FileVault turned on (System Settings, Privacy and Security, FileVault). The installer refuses without it, for the same reason as the Linux disk check.
- Docker Desktop or OrbStack, opened once.
- Homebrew's OpenSSL and jq: `brew install openssl@3 jq`. The OpenSSL that ships with macOS cannot check Vyre's signature.

Run this as yourself, not with sudo:

```sh
curl -fsSL https://github.com/vyre-ai/vyre-v1/releases/download/channel-beta/install-mac.sh | sh -s -- --channel beta --relay
```

The server starts when you log in, and it updates itself every night at 4. Docker has to be open. A Mac that goes to sleep stops serving, so set it to stay awake when plugged in (System Settings, Battery).

The command `vyre-server` lands in `~/.local/bin`. If your shell does not find it, add that folder to your PATH. To remove the server, run the same line with `--uninstall` in place of `--relay`.

**A lighter option for one Mac.** The desktop app can also run a Space on your Mac while the app is open: in the app choose Create a Space, then Team Space, then Run this Mac as the Space server. Your team reaches it through the relay while the app is open. Use the installer above for anything that has to stay up when nobody is at the Mac.

## 3. Open your Space for the first time

The first time the server starts, it makes a one-time link that makes you the owner. It is valid for 24 hours. On the server, run:

```sh
sudo vyre-server claim-link
```

- **With your own name,** the link starts with your address (`https://vyre.example.com/claim/...`). Open it in a browser, or install the app on your own computer (next two sections), choose Create a Space, then Team Space, paste the link, and pick your name and password.
- **With the relay,** the link opens only on the server itself and starts with `http://0.0.0.0`. That is not an address you can open from another computer. In the Vyre app, add the server from the app (it shows an install line with a one-time code) and carry on there. To reach a web page for your team, install with `--domain` instead.

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

1. On the phone, open your Space's address (the `https` name from `--domain`) in Safari (iPhone) or Chrome (Android). It is the address your team uses to reach the server.
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
- **Logs:** `vyre-server logs vyred` (the Space) or `vyre-server logs caddy` (the web front door) follow the log until you press Ctrl-C; add `--no-follow` to print the last lines and exit.
