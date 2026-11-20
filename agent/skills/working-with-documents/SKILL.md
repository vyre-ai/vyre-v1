---
name: working-with-documents
description: Make a document from a template, check it, and send it for signature. Load this before you fill a template, write a new one, or send anything to be signed.
system: true
---

# Working with documents

A template is a page with named blanks, called fields: `{client.name}`, `{matter.fee}`, `{signing_date}`. A person marks a Word file or a Vyre document (a Markdown file) as a template. You never write or retype a filled document. The server fills it, the same way every time.

## Make one
- `documents_make` with the template's name and the record: `{ template: "Service agreement", recordId }`. It lands in the record's files, in a form you can send. The answer is the file and the fields that were missing, never the text.
- A field the record does not hold stops it and is named. Ask the person for the value, or read it from the record, then call again with `values: { client: { name: "…" } }`. A date is never typed into a field: give `signingDate` as `2026-11-19`.
- `documents_fields` lists what a template asks for before you fill it. `documents_templates_list` lists the templates; pass `name` to find one.
- `documents_make_pdf` makes a PDF of a Vyre document (a `.md` file) that is already in Files: `{ fileId, intoFolderId }`. A blank still in its text stops it and is named. `documents_fill` fills a template into a folder with no record, and `documents_preview_fill` shows the result with the missing and unused fields before anything is saved.
- `esign_send` returns a link for each signer, and emails it when the Space can.
- A PDF that is not the exact copy of the Word page (the plain page look, or one that could not be checked) waits for a person to choose before `esign_send` sends it. You cannot make that choice for them: tell them and wait.
- A Word template fills to Word (`format: "docx"`) or to a PDF. A Vyre document fills to a PDF, or to `md` to go on editing.
- `layout` in the answer says whether a PDF kept the Word page (`word`) or was set in the plain page look (`simple`). Tell the person when it is `simple` and the Word page matters to them.

## Write a template
- Write a Vyre document as Markdown. Put a field where a value goes: `{client.name}`. A list repeats with `{#items}…{/items}`; a section shows only when a field is set with `{#paid}…{/paid}`.
- `{sign:client}` is where the person with the role `client` signs, and `{date:client}` where the date goes. Two signers on one line: `{sign:client} || {sign:firm}`.
- Save it in Files, then `documents_mark_template` with `recordType` when it is for one kind of record. Run `documents_fields` and read it back to the person before you rely on it.

## Send for signature
- Only a PDF is signed. A Vyre document's PDF already knows where each role signs. Call `esign_send` with the file and one signer for each role, in the order the make answer's `signers` names them. Give a signer an email, or a link comes back to hand over.
- `esign_send` waits for the person's yes. Say who it goes to and what it is before you call it. Never send a document the person has not seen.
- `esign_status` says where it stands. A person reminds a signer from the request's page, which gives a new link and stops the old one. `esign_cancel` stops every link. A request that runs out can be sent again.
- When everyone has signed, the signed PDF is saved beside the original, and `esign_fetch_signed` hands back its file. Never copy it elsewhere by hand.

## Never
- Never put a filled document's text in a chat or a note. Name the file.
- Never send or cancel a request the person did not ask for.
- Never change a signed or sent file. Make a new one from the template.
