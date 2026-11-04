# Northwind Portal

A client portal for law firms. Clients sign in, see their files, upload new ones and message the team.
It runs on one server and keeps everything in one place.

[![Build](https://img.shields.io/badge/build-passing-green.svg)](https://example.com/build)

## Contents

- [Install](#install)
- [Configure](#configure)
  - [Environment](#environment)
  - [Secrets](#secrets)
- [Use](#use)
- [Contribute](#contribute)

## Install

You need Node 20 and a Postgres database. Then:

```sh
git clone https://example.com/northwind/portal.git
cd portal
npm install
```

Some notes on the install:

1. Run `npm run db:migrate` once.
2. Seed the owner with `npm run db:seed`.
   The seed asks for an email and a password.
3. Start the server with `npm run dev`.

   It listens on port 3000 and logs each request.

## Configure

Set these variables in `.env`:

| Name | What it does | Default |
| --- | --- | --- |
| `DATABASE_URL` | Where Postgres lives | none |
| `PORT` | The port to listen on | `3000` |
| `SESSION_SECRET` | Signs the session cookie | none |

### Environment

Names use `snake_case` and never contain spaces. A file called book_consult_notes.md is fine, and so is a path like C:\Users\Maya\notes.

* One bullet with a star
* Another one, with *emphasis*, **strong text**, ~~strike~~ and a [link](https://example.com/docs "The docs")
+ A plus bullet in its own list

### Secrets

> Never commit a secret.
> Use the vault key name instead.

Task list for the release:

- [x] Write the changelog
- [ ] Tag the release
- [ ] Tell the team

<details>
<summary>More</summary>

Hidden text with <b>html</b>.

</details>

## Use

Open the app, sign in, and pick a client. The page shows:

- Files, newest first
- Messages, with the unread count
- Tasks, grouped by owner

---

## Contribute

Read CONTRIBUTING.md first. Then open a pull request.
Keep it small.
Test it.

Term one
: not a definition list here, only text

[docs]: https://example.com/docs
[repo]: https://example.com/repo

    indented code stays as it is
    on two lines

The end.
