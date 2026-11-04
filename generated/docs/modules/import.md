# Import (import)

Lane L3. Kind module. Version 0.1.0.

Requires: schema.

## Capabilities (19)

- [import.commit](../capabilities/import.commit.md): Write the previewed rows as an import Run; no automations fire unless runAutomations is true
- [import.discard](../capabilities/import.discard.md): Drop a staged import before it is committed
- [import.get](../capabilities/import.get.md): Read one import: state, counts and the file of row errors
- [import.list](../capabilities/import.list.md): History of imports
- [import.parse_airtable](../capabilities/import.parse_airtable.md): Stage the tables of an Airtable base using a key held in the Vault
- [import.parse_csv](../capabilities/import.parse_csv.md): Stage a CSV or pasted CSV text and report its columns with inferred field types
- [import.parse_excel](../capabilities/import.parse_excel.md): Stage the sheets of an Excel file and report their columns
- [import.parse_google_sheets](../capabilities/import.parse_google_sheets.md): Stage the tabs of a Google Sheet the connected account can open
- [import.parse_notion](../capabilities/import.parse_notion.md): Stage a Notion database or an export file using a key held in the Vault
- [import.preview](../capabilities/import.preview.md): Preview an import: rows to create, update or skip, row errors, new fields, and a preview token
- [import.suggest_mapping](../capabilities/import.suggest_mapping.md): Suggest which column feeds which field of a record type, with a confidence for each
- [import.template](../capabilities/import.template.md): A CSV template for a record type: header row and one example row
- [sessions.archive](../capabilities/sessions.archive.md): Move an imported session to the owner Archived list, or back out of it with unarchive
- [sessions.continue](../capabilities/sessions.continue.md): Start a separate live Vyre chat linked to an immutable imported conversation; it never writes back to the local provider store
- [sessions.delete](../capabilities/sessions.delete.md): Remove an imported session from Vyre: its copied transcript is dropped and a later import of the same source session skips it. The original Claude Code or Codex files on the computer are never touched, and a chat continued from it stays and keeps working
- [sessions.get](../capabilities/sessions.get.md): Read an immutable imported session transcript owned by the signed-in person
- [sessions.import](../capabilities/sessions.import.md): Copy previewed local Codex or Claude Code sessions into immutable owner-private Vyre conversations; provider adapters supply visible user and assistant text and, on assistant messages, the tool calls with their one-line summaries and the start of their results (credentials removed)
- [sessions.list](../capabilities/sessions.list.md): List the current owner private imported session archive in this Personal Space; in any other Space the list is empty and personalOnly is true
- [sessions.rename](../capabilities/sessions.rename.md): Give an imported session a new title in Vyre. Only the title shown changes: the copied transcript and its source provenance stay as they were

## Events (8)

- [import.completed](../events/import.completed.md): An import finished
- [import.failed](../events/import.failed.md): An import stopped on an error; rows already written stay and the Run can be undone
- [import.started](../events/import.started.md): An import Run began writing rows
- [sessions.archived](../events/sessions.archived.md): An imported session moved to the owner Archived list, or back out of it
- [sessions.continued](../events/sessions.continued.md): An imported archival session was continued in a separate live Vyre chat
- [sessions.deleted](../events/sessions.deleted.md): An imported session was removed from Vyre; the original local files and any chat continued from it stay
- [sessions.imported](../events/sessions.imported.md): A local Codex or Claude Code session was copied into an immutable provenance-marked archive
- [sessions.renamed](../events/sessions.renamed.md): An imported session was given a new title in Vyre; its copied transcript is unchanged
