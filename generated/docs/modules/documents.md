# Documents (documents)

Lane L4. Kind module. Version 0.1.0.

Requires: files.

## Capabilities (7)

- [documents.fields](../capabilities/documents.fields.md): List the fields a template needs (the {blanks} in it): text, date, money, lists and conditions
- [documents.fill](../capabilities/documents.fill.md): Fill a template into a new file in a folder; missing required fields stop the fill and are listed
- [documents.make_pdf](../capabilities/documents.make_pdf.md): Make a PDF of a Vyre document (.md) in a folder; a blank still in its text stops it and is named
- [documents.mark_template](../capabilities/documents.mark_template.md): Mark a Word file (.docx) or a Vyre document (.md) as a template, optionally for one record type, or unmark it
- [documents.preview_fill](../capabilities/documents.preview_fill.md): Show the filled document as an excerpt with every filled value marked, and what is missing or unused
- [documents.signing](../capabilities/documents.signing.md): Where the signers of a PDF made from a Vyre document sign, and what it was filled from
- [documents.templates.list](../capabilities/documents.templates.list.md): List files marked as templates the caller can open

## Events (2)

- [document.filled](../events/document.filled.md): A document was made by filling a template
- [document.template_marked](../events/document.template_marked.md): A file was marked or unmarked as a template
