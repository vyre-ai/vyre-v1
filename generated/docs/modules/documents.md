# Documents (documents)

Lane L4. Kind module. Version 0.1.0.

Requires: files.

## Capabilities (5)

- [documents.fields](../capabilities/documents.fields.md): List the tags a template needs: text, date, money, list, conditions and loops
- [documents.fill](../capabilities/documents.fill.md): Fill a template into a new file in a folder; missing required tags stop the fill and are listed
- [documents.mark_template](../capabilities/documents.mark_template.md): Mark a docx file as a template, or unmark it
- [documents.preview_fill](../capabilities/documents.preview_fill.md): Show the filled document as an excerpt with every filled value marked, and what is missing or unused
- [documents.templates.list](../capabilities/documents.templates.list.md): List files marked as templates the caller can open

## Events (2)

- [document.filled](../events/document.filled.md): A document was made by filling a template
- [document.template_marked](../events/document.template_marked.md): A file was marked or unmarked as a template
