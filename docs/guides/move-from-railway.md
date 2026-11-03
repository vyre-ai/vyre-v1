# Move your Railway app to Vyre

This guide moves an app you run on Railway (a dashboard, an API, a small site) onto your Team Space. Vyre builds it from your code and runs it on the Space's own server. Only people in your Space can open it unless you change that.

It takes about as long as a Railway deploy. You need:

- your app's code: a GitHub repo, or the project folder on your computer
- the values of its env vars (Railway: your service, then Variables)
- if it has a database on Railway: that database's connection string (Railway: the Postgres service, then Variables, `DATABASE_URL`)

## 1. Put the secrets in the Vault

Every env var that holds a secret (API keys, the database string) goes in the Vault first. Vyre never shows or logs these values.

1. Open **Vault** and add an item in a **Shared** folder for each value, for example `CX Stripe key`. Use Shared, not Mine: the server fills these values when it deploys.
2. If your repo is private, add your GitHub token too. It needs read access to that repo.
3. If you want to copy your Railway database, add its `DATABASE_URL` as an item named `Railway database`.

## 2. Make the site

1. Open **Apps**. It opens on **Sites**.
2. Press **New site**.
3. Pick one:
   - **GitHub repo**: paste the address, for example `github.com/acme/cx-dashboard`. Add the branch if it is not `main`. If the app lives in a subfolder, put it in **App folder**. If the repo is private, pick your GitHub token.
   - **Folder or zip**: choose the project folder or a `.zip` of it. Leave `node_modules` out (Vyre skips it anyway).
   - **Ask an agent**: describe what you want and an agent does the rest, including moving a project.
4. Give it a name and press **Deploy**.

The site page opens and the build log runs live. Vyre reads your project the way Railway does:

- `railway.json` or `railway.toml`: the build command, the start command and the health check path
- `nixpacks.toml`, a `Procfile` web line, or `package.json` scripts
- `requirements.txt` or `pyproject.toml` for Python, or your own `Dockerfile`

Your app must listen on the `PORT` env var on `0.0.0.0`, the same as on Railway.

## 3. Add the env vars

On the site page, under **Env vars**:

1. Type the name, for example `STRIPE_KEY`, and pick the Vault item that holds it.
2. Press **Add env var**. Repeat for each one.
3. Vyre lists names your project's `.env.example` mentions that are still missing. Press one to fill its name in.
4. Press **Deploy now** so the app gets them.

`PORT` is set for you.

## 4. Add a database, if it uses one

If the app needs Postgres (it has `DATABASE_URL`, or uses `pg`, Prisma, SQLAlchemy and so on), the build log says so.

1. Under **Database**, press **Add Postgres**. The app gets `DATABASE_URL` on its next deploy. Redis works the same and gives `REDIS_URL`.
2. To bring your data from Railway: pick the `Railway database` Vault item and press **Copy from that database**. Or upload a `pg_dump` file. Copying replaces tables with the same name.
3. Press **Deploy now**.

The database lives on the Space's server and keeps its data through every redeploy.

## 5. Open it

When the status says **Live**, press **Open**. The address looks like `https://cx-dashboard.mla.vyre.run`.

- **People in this Space** (the default): teammates open the address, sign in to Vyre once, and get in. Someone removed from the Space loses access at once.
- **Anyone with the password**: set a password on the site page, then pick this.
- **Anyone with the address**: public. Press **Publish** to put it on the internet.
- **Only you and people you share with**: private.

To use your own domain, add it under **Domains**. Vyre shows the DNS record to set and gets the certificate itself.

## Every day after

- **Push to GitHub** and the site deploys again within a minute. Turn this off under **Resources**.
- **Something broke?** Under **Deploys**, press **Roll back** on the last good one. It comes back in seconds, without a rebuild.
- **A deploy failed?** The page says why in plain words, with one button to fix it: add the database, add the missing env var, give it more memory, or ask an agent to fix the code. Until a new deploy works, the last good one keeps serving.
- **Logs**: **App log** shows what your app prints. **Show the build log** shows the last build.
- **Resources**: a site gets 1 CPU and 512 MB by default. Raise it there if it runs out of memory.

## When you are done on Railway

Check the Vyre site with your team for a day, then remove the Railway service and its database.

## For the person who runs the server

Sites need two things on the Space's server:

1. **The sites runner.** Vyre Server 1.0.0-rc.17 and later run it beside Vyre: a small service that alone holds the Docker socket and builds and runs only site containers, on the `vyre-sites` network, with every capability dropped and a CPU, memory and process cap. Vyre itself never holds the socket. A new install has it; an existing server gets it with `vyre-server update`. `vyre-server check` lists it.
2. **An address for sites.** One DNS record: `*.<your Space's domain>` as an A record to the server's IP (DNS only, not proxied). For My Legal Academy that is `*.mla.vyre.run`, already in place, so sites are `<name>.mla.vyre.run`. Vyre notices the record by itself. `VYRE_SITES_DOMAIN` in `vyre.env` names another wildcard domain instead.
