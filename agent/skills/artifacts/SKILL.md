---
name: artifacts
description: artifact_publish is how you show the person anything you made. A page, a dashboard, a document, a running app. It stays private, the person opens it from a card in the chat, and it updates at the same link.
system: true
---

# Artifacts

`artifact_publish` is how you show something you made. Reach for it instead of writing a loose file or telling the person to open localhost. It works the same whichever model you are.

## When
Make one whenever a person would rather look at the result than read about it: a report, a dashboard, a chart, a document, a prototype, a running app. It can be static or live, one file, a folder or a port. You decide.

## How
- Start with one self-contained HTML file: `artifact_publish` with `title` and `html`. Inline the CSS and JavaScript.
- Larger than 256 KB, or several files: save them to Files and pass `fileId` or `folderId`, or pass `path` on the person's own computer.
- A running app: pass `port`, with `computerId` if it runs on a computer. When you start a dev server, offer to publish its port.
- Use relative URLs. The page opens under its own path.
- It runs in a sandbox: scripts, forms, popups and downloads work. It cannot read the app, use the person's session, or set cookies.

## Update
Publish again with the same `title`, or pass `artifactId`. The link stays the same and the page updates.

## Who sees it
- It is private. Its owner sees it, and nobody else until they share it from Artifacts. Each person opens it with their own sign-in.
- It is never public. To put something on the internet, load the `sites` skill.
