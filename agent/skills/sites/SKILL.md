---
name: sites
description: Put anything on the web. Build and run any site or app on a computer, then give it an address with a route. Any stack, any size. Load this before you build or publish a site.
system: true
---

# Sites

You build and run the site. Vyre gives it an address. A site is a route: a name, where it runs, and who may reach it. There is no limit on stack or size, so choose what fits the job.

## Run it on a computer
- Use your agent computer (`terminal_open`, or `computers_provision` if you have none) or a server of the Space. Never run a site in Vyre itself.
- Keep it in `~/sites/<name>`, in git. Listen on `0.0.0.0`.
- Keep it running with a process manager (pm2, supervisord, or a loop in tmux) that restarts it, and write its output to `~/sites/<name>/site.log`. That file is what Logs shows.
- Secrets are Vault handles. Fill them at start and never write a value in a file, a commit or a message.

## Serve under /p/<name>
- On a name.vyre.run address a site lives at `https://name.vyre.run/p/<name>/`, with the whole path passed to your app. Set the base path (`base`, `basePath`, `PUBLIC_URL`, or a router prefix) to `/p/<name>/`.
- Use relative URLs. The header `x-forwarded-prefix` names the base path if your app wants it at run time.
- That page runs in a sandbox: no cookies, no local storage, no sign-in. A POST of up to 8 MB and a fetch to its own path work. A site that needs cookies or storage belongs on a custom domain.

## Publish
1. `sites_create` with a name, `computerId`, `port`. A folder of plain files needs no server: pass `folderId` instead.
2. `sites_status`: it must say answering. If it does not, read `sites_logs` and fix it.
3. Public: `sites_promote`. It goes ahead when the person asked this turn. Otherwise it stops for their yes, so say what is waiting.
   Space only: set `access: "space"` and call `sites_publish`. It opens at `/a/<id>` for people signed in.
4. Curl the address, show it to the person, and check it as a visitor would see it.

`sites_host` says what this Space can do. Publishing keeps the computer awake.

## Custom domains
- A custom domain is public, so only a public site has one, and it serves once the site is published. `sites_domain_add` returns the exact DNS records and adds the route with automatic TLS. Show the person those records. Never change their DNS yourself.
- `sites_domain_check` says `waiting_dns`, `issuing` or `live`.
- A custom domain needs a server with a public address. If there is none, say so and offer Add a server in Settings, Computers.

## Update and roll back
- Update with git: commit, restart, then `sites_status`. The address stays.
- Roll back with git: check out the last good commit and restart. Tag what you publish so you can.
- `sites_stop` takes the address down. The process keeps running until you stop it.
